import { Injectable } from '@nestjs/common';
import type { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '../shared';

export interface SocketData {
  sessionId: string;
  pid: string;
  /** room codes this socket joined, with role */
  rooms: Map<string, 'host' | 'player'>;
  events: number[];
}

export type UzuzServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

export const roomChannel = (code: string) => `r:${code}`;
export const memberChannel = (code: string, sessionId: string) => `r:${code}:${sessionId}`;
export const sessionChannel = (sessionId: string) => `s:${sessionId}`;

/** Holds the Socket.IO server so HTTP services can push real-time notifications. */
@Injectable()
export class RealtimeService {
  private io: UzuzServer | null = null;

  setServer(io: UzuzServer): void {
    this.io = io;
  }

  getServer(): UzuzServer | null {
    return this.io;
  }

  /** Real-time notification to every open tab of a guest session. */
  notifySession<E extends keyof ServerToClientEvents>(
    sessionId: string,
    event: E,
    payload: Parameters<ServerToClientEvents[E]>[0]
  ): void {
    if (!this.io) return;
    (this.io.to(sessionChannel(sessionId)) as unknown as { emit: (e: string, p: unknown) => void }).emit(event, payload);
  }
}
