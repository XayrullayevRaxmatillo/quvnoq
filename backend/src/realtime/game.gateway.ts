import { Inject, Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway
} from '@nestjs/websockets';
import type { Socket } from 'socket.io';
import { parse as parseCookie } from 'cookie';
import mongoose from 'mongoose';
import type { ZodTypeAny, z } from 'zod';
import {
  COLOR_TEAMS,
  answerSubmitSchema,
  codeOnlySchema,
  kickSchema,
  lockSchema,
  roomJoinSchema,
  teamSelectSchema,
  type Ack,
  type ClientToServerEvents,
  type ErrorCode,
  type ServerToClientEvents
} from '../shared';
import { env } from '../config/env';
import { SESSION_COOKIE, findSessionByToken } from '../common/middleware/session.service';
import { GameManager } from '../game/manager';
import type { Outbox } from '../game/engine';
import { presence } from '../services/presence';
import { GuestSession } from '../models/GuestSession';
import { Team } from '../models/Team';
import { RealtimeService, memberChannel, roomChannel, sessionChannel, type SocketData, type UzuzServer } from './realtime.service';

type UzuzSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

// code|sessionId|role -> number of open sockets
const connections = new Map<string, number>();
const connKey = (code: string, sid: string, role: 'host' | 'player') => `${code}|${sid}|${role}`;

const EVENT_WINDOW_MS = 5000;
const EVENT_LIMIT = 40;

const failAck = (code: ErrorCode): Ack<never> => ({ ok: false, code });

function rateLimited(socket: UzuzSocket): boolean {
  const now = Date.now();
  const events = socket.data.events.filter((t) => now - t < EVENT_WINDOW_MS);
  events.push(now);
  socket.data.events = events;
  return events.length > EVENT_LIMIT;
}

/**
 * Real-time game transport (Socket.IO on the same HTTP server as the REST API).
 * Every event is throttled, validated with the shared Zod schema and always answered
 * through the client's ack callback exactly once.
 */
@WebSocketGateway({
  cors: { origin: env.clientOrigins, credentials: true },
  pingInterval: 20_000,
  pingTimeout: 20_000,
  maxHttpBufferSize: 16 * 1024
})
export class GameGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger('Socket');
  private io!: UzuzServer;

  constructor(
    @Inject(RealtimeService) private readonly realtime: RealtimeService,
    @Inject(GameManager) private readonly games: GameManager
  ) {}

  afterInit(server: UzuzServer): void {
    this.io = server;
    this.realtime.setServer(server);
    this.games.init((code) => this.createOutbox(code));

    // Authenticate with the same httpOnly guest cookie used by the REST API.
    server.use(async (socket, next) => {
      try {
        const cookies = parseCookie(socket.handshake.headers.cookie ?? '');
        const session = await findSessionByToken(cookies[SESSION_COOKIE]);
        if (!session) return next(new Error('SESSION_REQUIRED'));
        socket.data.sessionId = session._id.toString();
        socket.data.pid = session.publicId;
        socket.data.rooms = new Map();
        socket.data.events = [];
        next();
      } catch (err) {
        next(err as Error);
      }
    });
  }

  handleConnection(socket: UzuzSocket): void {
    const sid = socket.data.sessionId;
    if (!sid) return;
    presence.connect(sid);
    void socket.join(sessionChannel(sid));
  }

  handleDisconnect(socket: UzuzSocket): void {
    const sid = socket.data.sessionId;
    if (!sid) return;
    presence.disconnect(sid);
    for (const code of [...(socket.data.rooms?.keys() ?? [])]) this.leaveRoom(socket, code);
  }

  /* ---------------- helpers ---------------- */

  private async run<S extends ZodTypeAny, R>(
    socket: UzuzSocket,
    event: keyof ClientToServerEvents,
    schema: S,
    payload: unknown,
    handler: (p: z.output<S>) => Promise<Ack<R>> | Ack<R>
  ): Promise<Ack<R>> {
    if (rateLimited(socket)) return failAck('RATE_LIMITED');
    const parsed = schema.safeParse(payload);
    if (!parsed.success) return failAck('BAD_REQUEST');
    try {
      return await handler(parsed.data);
    } catch (err) {
      this.logger.error(`${String(event)} failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
      return failAck('INTERNAL');
    }
  }

  private createOutbox(code: string): Outbox {
    const io = this.io;
    return {
      room(event, payload) {
        (io.to(roomChannel(code)) as unknown as { emit: (e: string, p: unknown) => void }).emit(event, payload);
      },
      session(sessionId, event, payload) {
        (io.to(memberChannel(code, sessionId)) as unknown as { emit: (e: string, p: unknown) => void }).emit(event, payload);
      },
      evict(sessionId) {
        io.in(memberChannel(code, sessionId)).socketsLeave([roomChannel(code), memberChannel(code, sessionId)]);
        connections.delete(connKey(code, sessionId, 'player'));
        for (const s of io.sockets.sockets.values()) {
          const sock = s as UzuzSocket;
          if (sock.data.sessionId === sessionId) sock.data.rooms.delete(code);
        }
      }
    };
  }

  private leaveRoom(socket: UzuzSocket, code: string): void {
    const role = socket.data.rooms.get(code);
    if (!role) return;
    socket.data.rooms.delete(code);
    void socket.leave(roomChannel(code));
    void socket.leave(memberChannel(code, socket.data.sessionId));
    const key = connKey(code, socket.data.sessionId, role);
    const remaining = (connections.get(key) ?? 1) - 1;
    if (remaining > 0) {
      connections.set(key, remaining);
      return;
    }
    connections.delete(key);
    const room = this.games.get(code);
    if (!room) return;
    if (role === 'host') room.detachHost(socket.data.sessionId);
    else room.setDisconnected(socket.data.sessionId);
  }

  /* ---------------- events ---------------- */

  @SubscribeMessage('time:sync')
  timeSync(): number {
    return Date.now();
  }

  @SubscribeMessage('room:join')
  roomJoin(@ConnectedSocket() socket: UzuzSocket, @MessageBody() payload: unknown) {
    const sid = socket.data.sessionId;
    return this.run(socket, 'room:join', roomJoinSchema, payload, async (p) => {
      const room = this.games.get(p.code);
      if (!room) return failAck('ROOM_NOT_FOUND');

      if (p.role === 'host') {
        const res = room.attachHost(sid);
        if (!res.ok) return res;
      } else {
        const res = room.join(sid, socket.data.pid, { nickname: p.nickname, avatar: p.avatar, color: p.color });
        if (!res.ok) return res;
        // Remember the player's preferences server-side as well.
        if (!res.data.reconnected && p.nickname) {
          void GuestSession.updateOne(
            { _id: sid },
            { $set: { nickname: p.nickname.trim().slice(0, 20), avatar: p.avatar ?? 0, color: p.color ?? 0 } }
          ).catch(() => undefined);
        }
      }

      if (!socket.data.rooms.has(p.code)) {
        socket.data.rooms.set(p.code, p.role);
        await socket.join([roomChannel(p.code), memberChannel(p.code, sid)]);
        const key = connKey(p.code, sid, p.role);
        connections.set(key, (connections.get(key) ?? 0) + 1);
      }

      // Team mode: offer the player's real UZUZ teams as options.
      if (room.mode === 'team' && p.role === 'player') {
        const teams = await Team.find({ status: 'active', 'members.session': sid }).select('name emoji').lean();
        for (const t of teams) {
          room.addTeamOption({ key: `team:${t._id.toString()}`, name: `${t.emoji} ${t.name}`, color: null, teamId: t._id.toString() });
        }
      }

      room.syncSession(sid);
      return { ok: true as const, data: { pid: room.isHost(sid) && p.role === 'host' ? room.hostPid : socket.data.pid, isHost: room.isHost(sid) } };
    });
  }

  @SubscribeMessage('room:leave')
  roomLeave(@ConnectedSocket() socket: UzuzSocket, @MessageBody() payload: unknown) {
    return this.run(socket, 'room:leave', codeOnlySchema, payload, (p) => {
      const room = this.games.get(p.code);
      this.leaveRoom(socket, p.code);
      room?.leave(socket.data.sessionId);
      return { ok: true as const, data: undefined };
    });
  }

  @SubscribeMessage('host:start')
  hostStart(@ConnectedSocket() socket: UzuzSocket, @MessageBody() payload: unknown) {
    return this.run(socket, 'host:start', codeOnlySchema, payload, (p) => {
      const room = this.games.get(p.code);
      if (!room) return failAck('ROOM_NOT_FOUND');
      return room.start(socket.data.sessionId);
    });
  }

  @SubscribeMessage('host:next')
  hostNext(@ConnectedSocket() socket: UzuzSocket, @MessageBody() payload: unknown) {
    return this.run(socket, 'host:next', codeOnlySchema, payload, (p) => {
      const room = this.games.get(p.code);
      if (!room) return failAck('ROOM_NOT_FOUND');
      return room.next(socket.data.sessionId);
    });
  }

  @SubscribeMessage('host:playAgain')
  hostPlayAgain(@ConnectedSocket() socket: UzuzSocket, @MessageBody() payload: unknown) {
    return this.run(socket, 'host:playAgain', codeOnlySchema, payload, (p) => {
      const room = this.games.get(p.code);
      if (!room) return failAck('ROOM_NOT_FOUND');
      return room.playAgain(socket.data.sessionId);
    });
  }

  @SubscribeMessage('host:kick')
  hostKick(@ConnectedSocket() socket: UzuzSocket, @MessageBody() payload: unknown) {
    return this.run(socket, 'host:kick', kickSchema, payload, (p) => {
      const room = this.games.get(p.code);
      if (!room) return failAck('ROOM_NOT_FOUND');
      return room.kick(socket.data.sessionId, p.pid);
    });
  }

  @SubscribeMessage('host:lock')
  hostLock(@ConnectedSocket() socket: UzuzSocket, @MessageBody() payload: unknown) {
    return this.run(socket, 'host:lock', lockSchema, payload, (p) => {
      const room = this.games.get(p.code);
      if (!room) return failAck('ROOM_NOT_FOUND');
      return room.setLocked(socket.data.sessionId, p.locked);
    });
  }

  @SubscribeMessage('answer:submit')
  answerSubmit(@ConnectedSocket() socket: UzuzSocket, @MessageBody() payload: unknown) {
    return this.run(socket, 'answer:submit', answerSubmitSchema, payload, (p) => {
      const room = this.games.get(p.code);
      if (!room) return failAck('ROOM_NOT_FOUND');
      if (socket.data.rooms.get(p.code) !== 'player') return failAck('NOT_PLAYER');
      return room.submitAnswer(socket.data.sessionId, p.questionIndex, p.option);
    });
  }

  @SubscribeMessage('team:select')
  teamSelect(@ConnectedSocket() socket: UzuzSocket, @MessageBody() payload: unknown) {
    const sid = socket.data.sessionId;
    return this.run(socket, 'team:select', teamSelectSchema, payload, async (p) => {
      const room = this.games.get(p.code);
      if (!room) return failAck('ROOM_NOT_FOUND');
      if (p.teamKey.startsWith('team:')) {
        const teamId = p.teamKey.slice(5);
        if (!mongoose.isValidObjectId(teamId)) return failAck('TEAM_NOT_FOUND');
        const team = await Team.findOne({ _id: teamId, status: 'active', 'members.session': sid }).select('name emoji').lean();
        if (!team) return failAck('TEAM_NOT_MEMBER');
        room.addTeamOption({ key: p.teamKey, name: `${team.emoji} ${team.name}`, color: null, teamId });
      } else if (!COLOR_TEAMS.some((t) => t.key === p.teamKey)) {
        return failAck('TEAM_NOT_FOUND');
      }
      return room.selectTeam(sid, p.teamKey);
    });
  }
}
