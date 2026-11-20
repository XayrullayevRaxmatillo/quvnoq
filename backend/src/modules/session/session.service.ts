import { Injectable } from '@nestjs/common';
import type { z } from 'zod';
import { levelFromXp, type SessionDTO, type sessionUpdateSchema } from '../../shared';
import { GuestSession, SESSION_TTL_MS, type GuestSessionDoc } from '../../models/GuestSession';
import { PlayerStats } from '../../models/PlayerStats';
import { GameResult } from '../../models/GameResult';
import { Team } from '../../models/Team';
import { ApiError } from '../../utils/http';
import { newRestoreCode, newToken, normalizeRestoreCode, sha256 } from '../../utils/crypto';

@Injectable()
export class SessionService {
  async toDto(session: GuestSessionDoc): Promise<SessionDTO> {
    const stats = await PlayerStats.findOne({ session: session._id }).lean();
    const xp = stats?.xp ?? 0;
    return {
      pid: session.publicId,
      nickname: session.nickname ?? null,
      avatar: session.avatar,
      color: session.color,
      hideFromLeaderboard: session.hideFromLeaderboard,
      createdAt: (session as unknown as { createdAt: Date }).createdAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
      stats: {
        xp,
        level: levelFromXp(xp),
        games: stats?.games ?? 0,
        wins: stats?.wins ?? 0,
        correct: stats?.correct ?? 0,
        answered: stats?.answered ?? 0,
        bestStreak: stats?.bestStreak ?? 0,
        badges: stats?.badges ?? []
      }
    };
  }

  async update(s: GuestSessionDoc, body: z.output<typeof sessionUpdateSchema>): Promise<SessionDTO> {
    if (body.nickname !== undefined) s.nickname = body.nickname;
    if (body.avatar !== undefined) s.avatar = body.avatar;
    if (body.color !== undefined) s.color = body.color;
    if (body.hideFromLeaderboard !== undefined) s.hideFromLeaderboard = body.hideFromLeaderboard;
    await s.save();

    // Keep mirrors in sync for leaderboards and team member lists.
    const mirror: Record<string, unknown> = { avatar: s.avatar, color: s.color, hidden: s.hideFromLeaderboard };
    if (s.nickname) mirror.nickname = s.nickname;
    await PlayerStats.updateOne({ session: s._id }, { $set: mirror });
    if (s.nickname) {
      await Team.updateMany(
        { 'members.session': s._id },
        { $set: { 'members.$[m].nickname': s.nickname, 'members.$[m].avatar': s.avatar, 'members.$[m].color': s.color } },
        { arrayFilters: [{ 'm.session': s._id }] }
      );
    }
    return this.toDto(s);
  }

  /** One-time code that lets the user move this guest session to another device. */
  async createRestoreCode(s: GuestSessionDoc): Promise<{ code: string }> {
    const code = newRestoreCode();
    s.restoreCodeHash = sha256(code);
    await s.save();
    return { code };
  }

  /** Returns the restored session and its fresh cookie token. */
  async restore(code: string): Promise<{ session: GuestSessionDoc; token: string }> {
    const target = await GuestSession.findOne({ restoreCodeHash: sha256(normalizeRestoreCode(code)) });
    if (!target || target.expiresAt.getTime() < Date.now()) throw new ApiError(404, 'RESTORE_INVALID');
    // Rotate: the restored session gets a fresh token; the code is single-use.
    const token = newToken();
    target.tokenHash = sha256(token);
    target.restoreCodeHash = null;
    target.lastSeenAt = new Date();
    target.expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await target.save();
    return { session: target, token };
  }

  async history(s: GuestSessionDoc) {
    const results = await GameResult.find({ 'players.session': s._id }).sort({ finishedAt: -1 }).limit(20).lean();
    const sid = s._id.toString();
    return {
      items: results.map((r) => {
        const me = r.players.find((p) => p.session.toString() === sid)!;
        return {
          roomCode: r.roomCode,
          quizTitle: r.quizTitle,
          quizSlug: r.quizSlug,
          mode: r.mode,
          finishedAt: r.finishedAt,
          playerCount: r.playerCount,
          questionCount: r.questionCount,
          score: me.score,
          rank: me.rank,
          correct: me.correct,
          xp: me.xp
        };
      })
    };
  }
}
