import { Inject, Injectable } from '@nestjs/common';
import type { z } from 'zod';
import mongoose from 'mongoose';
import {
  CATEGORY_SLUGS,
  LANGS,
  MAX_TEAMS_PER_SESSION,
  SKILL_LEVELS,
  generateTeamCode,
  normalizeTeamCode,
  rankTeams,
  type TeamCardDTO,
  type TeamInput,
  type teamUpdateSchema
} from '../../shared';
import { Team, TeamJoinRequest, type TeamDoc } from '../../models/Team';
import type { GuestSessionDoc } from '../../models/GuestSession';
import { ApiError, clampInt, conflict, escapeRegex, forbidden, notFound, requireObjectId } from '../../utils/http';
import { randomInt } from '../../utils/crypto';
import { presence } from '../../services/presence';
import { RealtimeService } from '../../realtime/realtime.service';

type LeanTeam = {
  _id: mongoose.Types.ObjectId;
  name: string;
  description: string;
  emoji: string;
  subject: string;
  language: 'uz' | 'ru' | 'en';
  level: string;
  capacity: number;
  memberCount: number;
  visibility: 'public' | 'private';
  joinPolicy: 'open' | 'approval' | 'invite';
  totalScore: number;
  gamesPlayed: number;
  lastActiveAt: Date;
  owner: mongoose.Types.ObjectId;
  inviteCode: string;
  members: { session: mongoose.Types.ObjectId; pid: string; nickname: string; avatar: number; color: number; joinedAt: Date }[];
};

export interface MatchPrefs {
  subject?: (typeof CATEGORY_SLUGS)[number];
  language?: (typeof LANGS)[number];
  level?: (typeof SKILL_LEVELS)[number];
}

function card(t: LeanTeam): TeamCardDTO {
  return {
    id: t._id.toString(),
    name: t.name,
    description: t.description,
    emoji: t.emoji,
    subject: t.subject,
    language: t.language,
    level: t.level,
    capacity: t.capacity,
    memberCount: t.memberCount,
    visibility: t.visibility,
    joinPolicy: t.joinPolicy,
    totalScore: t.totalScore,
    gamesPlayed: t.gamesPlayed,
    lastActiveAt: new Date(t.lastActiveAt).toISOString(),
    members: t.members.slice(0, 6).map((m) => ({ pid: m.pid, nickname: m.nickname, avatar: m.avatar, color: m.color }))
  };
}

const PUBLIC_LIST = { status: 'active', visibility: 'public', hiddenByAdmin: false };

function memberEntry(g: GuestSessionDoc) {
  return { session: g._id, pid: g.publicId, nickname: g.nickname ?? `Mehmon_${g.publicId.slice(0, 4)}`, avatar: g.avatar, color: g.color, joinedAt: new Date() };
}

type MemberEntry = ReturnType<typeof memberEntry>;

function assertOwner(guest: GuestSessionDoc, team: TeamDoc): void {
  if (!team.owner.equals(guest._id)) throw forbidden('TEAM_NOT_OWNER');
}

@Injectable()
export class TeamsService {
  constructor(@Inject(RealtimeService) private readonly realtime: RealtimeService) {}

  private async assertTeamLimit(sessionId: mongoose.Types.ObjectId): Promise<void> {
    const n = await Team.countDocuments({ status: 'active', 'members.session': sessionId });
    if (n >= MAX_TEAMS_PER_SESSION) throw conflict('TEAM_LIMIT');
  }

  /** Atomic join: capacity, duplicate membership and status checked in one update. */
  private async atomicJoin(teamId: string, member: MemberEntry): Promise<TeamDoc> {
    const updated = await Team.findOneAndUpdate(
      {
        _id: teamId,
        status: 'active',
        'members.session': { $ne: member.session },
        $expr: { $lt: ['$memberCount', '$capacity'] }
      },
      { $push: { members: member }, $inc: { memberCount: 1 }, $set: { lastActiveAt: new Date() } },
      { new: true }
    );
    if (updated) return updated;
    const team = await Team.findById(teamId).lean();
    if (!team || team.status !== 'active') throw notFound('TEAM_NOT_FOUND');
    if (team.members.some((m) => m.session.equals(member.session))) throw conflict('TEAM_ALREADY_MEMBER');
    throw conflict('TEAM_FULL');
  }

  private async loadTeam(id: unknown): Promise<TeamDoc> {
    const teamId = requireObjectId(id, 'TEAM_NOT_FOUND');
    const team = await Team.findOne({ _id: teamId, status: 'active' });
    if (!team) throw notFound('TEAM_NOT_FOUND');
    return team;
  }

  private detail(guest: GuestSessionDoc, team: LeanTeam, extra: { pendingRequest: boolean; requestCount: number }) {
    const sid = guest._id;
    const isOwner = team.owner.equals(sid);
    const isMember = team.members.some((m) => m.session.equals(sid));
    return {
      ...card(team),
      members: [...team.members]
        .sort((a, b) => new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime())
        .map((m) => ({
          pid: m.pid,
          nickname: m.nickname,
          avatar: m.avatar,
          color: m.color,
          isOwner: team.owner.equals(m.session),
          online: presence.isOnline(m.session.toString()),
          joinedAt: new Date(m.joinedAt).toISOString()
        })),
      you: { isMember, isOwner, pendingRequest: extra.pendingRequest },
      // Invite code is visible to members (to share with friends); only the owner can regenerate it.
      inviteCode: isMember ? team.inviteCode : null,
      requestCount: isOwner ? extra.requestCount : 0
    };
  }

  /* ---------- Listing & discovery ---------- */

  async list(query: Record<string, unknown>) {
    const filter: Record<string, unknown> = { ...PUBLIC_LIST };
    const q = String(query.q ?? '').trim().slice(0, 40);
    if (q) filter.name = new RegExp(escapeRegex(q), 'i');
    const subject = String(query.subject ?? '');
    if ((CATEGORY_SLUGS as readonly string[]).includes(subject)) filter.subject = subject;
    const language = String(query.language ?? '');
    if ((LANGS as readonly string[]).includes(language)) filter.language = language;
    const level = String(query.level ?? '');
    if ((SKILL_LEVELS as readonly string[]).includes(level)) filter.level = level;
    if (query.hasSpace === '1') filter.$expr = { $lt: ['$memberCount', '$capacity'] };

    const sort: Record<string, 1 | -1> = query.sort === 'new' ? { createdAt: -1 } : { lastActiveAt: -1 };
    const limit = clampInt(query.limit, 1, 30, 12);
    const page = clampInt(query.page, 1, 500, 1);
    const [items, total] = await Promise.all([
      Team.find(filter).sort(sort).skip((page - 1) * limit).limit(limit).lean(),
      Team.countDocuments(filter)
    ]);
    return { items: (items as unknown as LeanTeam[]).map(card), total, page, pages: Math.ceil(total / limit) };
  }

  async mine(guest: GuestSessionDoc) {
    const items = await Team.find({ status: 'active', 'members.session': guest._id }).sort({ lastActiveAt: -1 }).lean();
    return {
      items: (items as unknown as LeanTeam[]).map((t) => ({ ...card(t), isOwner: t.owner.equals(guest._id) }))
    };
  }

  async match(guest: GuestSessionDoc, prefs: MatchPrefs) {
    const candidates = (await Team.find({
      ...PUBLIC_LIST,
      joinPolicy: { $ne: 'invite' },
      'members.session': { $ne: guest._id },
      $expr: { $lt: ['$memberCount', '$capacity'] }
    })
      .sort({ lastActiveAt: -1 })
      .limit(300)
      .lean()) as unknown as LeanTeam[];
    const ranked = rankTeams(prefs, candidates, 5);
    return { items: ranked.map((r) => ({ team: card(r.team), score: r.score, reasons: r.reasons })) };
  }

  /* ---------- Create ---------- */

  async create(guest: GuestSessionDoc, input: TeamInput) {
    await this.assertTeamLimit(guest._id);
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const team = await Team.create({
          ...input,
          owner: guest._id,
          members: [memberEntry(guest)],
          memberCount: 1,
          inviteCode: generateTeamCode(randomInt)
        });
        return { id: team._id.toString(), inviteCode: team.inviteCode };
      } catch (err) {
        if ((err as { code?: number }).code !== 11000) throw err;
      }
    }
    throw new ApiError(500, 'INTERNAL');
  }

  /* ---------- Join by invite code ---------- */

  async joinByCode(guest: GuestSessionDoc, code: string) {
    const team = await Team.findOne({ inviteCode: normalizeTeamCode(code), status: 'active' }).select('_id');
    if (!team) throw notFound('TEAM_INVALID_CODE');
    await this.assertTeamLimit(guest._id);
    const joined = await this.atomicJoin(team._id.toString(), memberEntry(guest));
    return { id: joined._id.toString(), status: 'joined' };
  }

  /* ---------- Detail ---------- */

  async get(id: string, guest: GuestSessionDoc, rawCode: unknown) {
    const teamId = requireObjectId(id, 'TEAM_NOT_FOUND');
    const team = (await Team.findOne({ _id: teamId, status: 'active' }).lean()) as unknown as (LeanTeam & { hiddenByAdmin: boolean }) | null;
    if (!team) throw notFound('TEAM_NOT_FOUND');
    const sid = guest._id;
    const isMember = team.members.some((m) => m.session.equals(sid));
    const code = typeof rawCode === 'string' ? normalizeTeamCode(rawCode) : null;
    // Private teams are visible only to members or to someone holding the invite code.
    if ((team.visibility === 'private' || team.hiddenByAdmin) && !isMember && code !== team.inviteCode) throw notFound('TEAM_NOT_FOUND');
    const [pending, requestCount] = await Promise.all([
      TeamJoinRequest.exists({ team: team._id, session: sid, status: 'pending' }),
      team.owner.equals(sid) ? TeamJoinRequest.countDocuments({ team: team._id, status: 'pending' }) : Promise.resolve(0)
    ]);
    return this.detail(guest, team, { pendingRequest: !!pending, requestCount });
  }

  /* ---------- Join / leave ---------- */

  async join(id: string, guest: GuestSessionDoc, code: string | undefined) {
    const team = await this.loadTeam(id);
    const sid = guest._id;
    if (team.members.some((m) => m.session.equals(sid))) throw conflict('TEAM_ALREADY_MEMBER');
    if (team.memberCount >= team.capacity) throw conflict('TEAM_FULL');
    await this.assertTeamLimit(sid);

    const hasCode = !!code && normalizeTeamCode(code) === team.inviteCode;
    if (hasCode || (team.visibility === 'public' && team.joinPolicy === 'open')) {
      await this.atomicJoin(team._id.toString(), memberEntry(guest));
      return { status: 'joined' };
    }
    if (team.joinPolicy === 'approval') {
      const existing = await TeamJoinRequest.findOne({ team: team._id, session: sid, status: 'pending' });
      if (existing) throw conflict('TEAM_REQUEST_PENDING');
      const m = memberEntry(guest);
      await TeamJoinRequest.create({ team: team._id, session: sid, pid: m.pid, nickname: m.nickname, avatar: m.avatar, color: m.color });
      this.realtime.notifySession(team.owner.toString(), 'team:request', { teamId: team._id.toString(), teamName: team.name, nickname: m.nickname });
      return { status: 'requested' };
    }
    throw forbidden('TEAM_INVITE_REQUIRED');
  }

  async leave(id: string, guest: GuestSessionDoc) {
    const team = await this.loadTeam(id);
    const sid = guest._id;
    const updated = await Team.findOneAndUpdate(
      { _id: team._id, 'members.session': sid },
      { $pull: { members: { session: sid } }, $inc: { memberCount: -1 } },
      { new: true }
    );
    if (!updated) throw conflict('TEAM_NOT_MEMBER');
    if (updated.members.length === 0) {
      updated.status = 'archived';
      await updated.save();
    } else if (updated.owner.equals(sid)) {
      // Ownership passes to the longest-standing member.
      const oldest = [...updated.members].sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime())[0];
      updated.owner = oldest.session;
      await updated.save();
    }
    return { ok: true };
  }

  /* ---------- Owner actions ---------- */

  async update(id: string, guest: GuestSessionDoc, body: z.output<typeof teamUpdateSchema>) {
    const team = await this.loadTeam(id);
    assertOwner(guest, team);
    if (body.capacity !== undefined && body.capacity < team.memberCount) throw conflict('TEAM_CAPACITY_TOO_LOW');
    Object.assign(team, body);
    await team.save();
    return { ok: true };
  }

  async kick(id: string, guest: GuestSessionDoc, pid: string) {
    const team = await this.loadTeam(id);
    assertOwner(guest, team);
    const target = team.members.find((m) => m.pid === pid);
    if (!target) throw notFound('TEAM_NOT_MEMBER');
    if (target.session.equals(team.owner)) throw forbidden('FORBIDDEN');
    await Team.updateOne(
      { _id: team._id, 'members.session': target.session },
      { $pull: { members: { session: target.session } }, $inc: { memberCount: -1 } }
    );
    return { ok: true };
  }

  async transfer(id: string, guest: GuestSessionDoc, pid: string) {
    const team = await this.loadTeam(id);
    assertOwner(guest, team);
    const target = team.members.find((m) => m.pid === pid);
    if (!target) throw notFound('TEAM_NOT_MEMBER');
    // Conditional update prevents races with concurrent ownership changes.
    const r = await Team.updateOne({ _id: team._id, owner: guest._id, 'members.session': target.session }, { $set: { owner: target.session } });
    if (!r.modifiedCount) throw forbidden('TEAM_NOT_OWNER');
    return { ok: true };
  }

  async regenerateInviteCode(id: string, guest: GuestSessionDoc) {
    const team = await this.loadTeam(id);
    assertOwner(guest, team);
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        team.inviteCode = generateTeamCode(randomInt);
        await team.save();
        return { inviteCode: team.inviteCode };
      } catch (err) {
        if ((err as { code?: number }).code !== 11000) throw err;
      }
    }
    throw new ApiError(500, 'INTERNAL');
  }

  async requests(id: string, guest: GuestSessionDoc) {
    const team = await this.loadTeam(id);
    assertOwner(guest, team);
    const items = await TeamJoinRequest.find({ team: team._id, status: 'pending' }).sort({ createdAt: 1 }).limit(100).lean();
    return {
      items: items.map((r) => ({
        id: r._id.toString(),
        pid: r.pid,
        nickname: r.nickname,
        avatar: r.avatar,
        color: r.color,
        createdAt: (r as unknown as { createdAt: Date }).createdAt
      }))
    };
  }

  async answerRequest(id: string, rid: string, guest: GuestSessionDoc, action: 'accept' | 'reject') {
    const team = await this.loadTeam(id);
    assertOwner(guest, team);
    const requestId = requireObjectId(rid);
    const request = await TeamJoinRequest.findOne({ _id: requestId, team: team._id, status: 'pending' });
    if (!request) throw notFound();

    if (action === 'accept') {
      const n = await Team.countDocuments({ status: 'active', 'members.session': request.session });
      if (n >= MAX_TEAMS_PER_SESSION) throw conflict('TEAM_LIMIT');
      await this.atomicJoin(team._id.toString(), {
        session: request.session,
        pid: request.pid,
        nickname: request.nickname,
        avatar: request.avatar,
        color: request.color,
        joinedAt: new Date()
      });
    }
    request.status = action === 'accept' ? 'accepted' : 'rejected';
    await request.save();
    this.realtime.notifySession(request.session.toString(), 'team:requestResult', {
      teamId: team._id.toString(),
      teamName: team.name,
      accepted: action === 'accept'
    });
    return { ok: true };
  }
}
