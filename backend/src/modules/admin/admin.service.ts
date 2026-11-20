import { Inject, Injectable } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { AdminSession, AdminUser, AuditLog, Report } from '../../models/misc';
import { Quiz } from '../../models/Quiz';
import { Team } from '../../models/Team';
import { Category } from '../../models/Category';
import { GameResult } from '../../models/GameResult';
import { GuestSession } from '../../models/GuestSession';
import { PlayerStats } from '../../models/PlayerStats';
import { ADMIN_SESSION_MS } from '../../common/guards/admin.guard';
import { ApiError, clampInt, escapeRegex, notFound, requireObjectId } from '../../utils/http';
import { newToken, sha256 } from '../../utils/crypto';
import { GameManager } from '../../game/manager';
import { quizCard } from '../quizzes/quizzes.service';

export interface AdminIdentity {
  id: string;
  username: string;
}

const DUMMY_HASH = bcrypt.hashSync('uzuz-timing-equalizer', 10);

@Injectable()
export class AdminService {
  constructor(@Inject(GameManager) private readonly games: GameManager) {}

  private async audit(admin: AdminIdentity, action: string, targetType: string, targetId: string, details: Record<string, unknown> = {}) {
    await AuditLog.create({ admin: admin.id, adminName: admin.username, action, targetType, targetId, details });
  }

  /* ---------- Auth ---------- */

  /** Returns the admin username and a new session token for the cookie. */
  async login(username: string, password: string): Promise<{ username: string; token: string }> {
    const admin = await AdminUser.findOne({ username: username.toLowerCase().trim() });
    // Always run bcrypt to keep timing uniform, even for unknown usernames.
    const okPw = await bcrypt.compare(password, admin?.passwordHash ?? DUMMY_HASH);
    if (!admin || !okPw) throw new ApiError(401, 'ADMIN_AUTH');
    const token = newToken();
    await AdminSession.create({ tokenHash: sha256(token), admin: admin._id, expiresAt: new Date(Date.now() + ADMIN_SESSION_MS) });
    admin.lastLoginAt = new Date();
    await admin.save();
    return { username: admin.username, token };
  }

  async logout(token: string | undefined): Promise<void> {
    if (token) await AdminSession.deleteOne({ tokenHash: sha256(token) });
  }

  /* ---------- Dashboard ---------- */

  async stats() {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const [quizzes, hiddenQuizzes, teams, sessions, gamesToday, gamesTotal, openReports] = await Promise.all([
      Quiz.countDocuments(),
      Quiz.countDocuments({ hidden: true }),
      Team.countDocuments({ status: 'active' }),
      GuestSession.countDocuments(),
      GameResult.countDocuments({ finishedAt: { $gte: startOfDay } }),
      GameResult.countDocuments(),
      Report.countDocuments({ status: 'open' })
    ]);
    return { quizzes, hiddenQuizzes, teams, sessions, gamesToday, gamesTotal, openReports, live: this.games.stats() };
  }

  /* ---------- Quizzes ---------- */

  async quizzes(query: Record<string, unknown>) {
    const filter: Record<string, unknown> = {};
    const q = String(query.q ?? '').trim().slice(0, 60);
    if (q) filter.title = new RegExp(escapeRegex(q), 'i');
    if (query.status === 'hidden') filter.hidden = true;
    if (query.status === 'reported') filter.reportsCount = { $gt: 0 };
    const page = clampInt(query.page, 1, 1000, 1);
    const [items, total] = await Promise.all([
      Quiz.find(filter).select('-questions').sort({ createdAt: -1 }).skip((page - 1) * 30).limit(30).lean(),
      Quiz.countDocuments(filter)
    ]);
    return {
      items: items.map((i) => ({ ...quizCard(i as never), hidden: i.hidden, featured: i.featured, reportsCount: i.reportsCount, visibility: i.visibility })),
      total,
      page,
      pages: Math.ceil(total / 30)
    };
  }

  async updateQuiz(admin: AdminIdentity, rawId: string, body: { hidden?: boolean; featured?: boolean }) {
    const id = requireObjectId(rawId, 'QUIZ_NOT_FOUND');
    const quiz = await Quiz.findByIdAndUpdate(id, { $set: body }, { new: true });
    if (!quiz) throw notFound('QUIZ_NOT_FOUND');
    await this.audit(admin, 'quiz.update', 'quiz', id, body);
    return { ok: true };
  }

  async deleteQuiz(admin: AdminIdentity, rawId: string) {
    const id = requireObjectId(rawId, 'QUIZ_NOT_FOUND');
    const quiz = await Quiz.findByIdAndDelete(id);
    if (!quiz) throw notFound('QUIZ_NOT_FOUND');
    await this.audit(admin, 'quiz.delete', 'quiz', id, { title: quiz.title });
    return { ok: true };
  }

  /* ---------- Reports ---------- */

  async reports(rawStatus: unknown) {
    const status = ['open', 'resolved', 'dismissed'].includes(String(rawStatus)) ? String(rawStatus) : 'open';
    const items = await Report.find({ status }).sort({ createdAt: -1 }).limit(100).lean();
    return {
      items: items.map((r) => ({
        id: r._id.toString(),
        targetType: r.targetType,
        targetId: r.targetId,
        targetLabel: r.targetLabel,
        reason: r.reason,
        details: r.details,
        status: r.status,
        createdAt: (r as unknown as { createdAt: Date }).createdAt
      }))
    };
  }

  async updateReport(admin: AdminIdentity, rawId: string, body: { status: 'open' | 'resolved' | 'dismissed'; hideTarget?: boolean }) {
    const id = requireObjectId(rawId);
    const report = await Report.findById(id);
    if (!report) throw notFound();
    report.status = body.status;
    await report.save();
    if (body.hideTarget) {
      if (report.targetType === 'quiz') await Quiz.updateOne({ _id: report.targetId }, { $set: { hidden: true } });
      if (report.targetType === 'team') await Team.updateOne({ _id: report.targetId }, { $set: { hiddenByAdmin: true } });
      if (report.targetType === 'player') await PlayerStats.updateOne({ pid: report.targetId }, { $set: { nameHidden: true } });
    }
    await this.audit(admin, 'report.update', 'report', id, body);
    return { ok: true };
  }

  /* ---------- Categories ---------- */

  async categories() {
    return { items: await Category.find().sort({ order: 1 }).lean() };
  }

  async upsertCategory(admin: AdminIdentity, slug: string, body: Record<string, unknown>) {
    await Category.updateOne({ slug }, { $set: body }, { upsert: true });
    await this.audit(admin, 'category.update', 'category', slug, body);
    return { ok: true };
  }

  /* ---------- Teams ---------- */

  async teams(query: Record<string, unknown>) {
    const filter: Record<string, unknown> = { status: 'active' };
    const q = String(query.q ?? '').trim().slice(0, 40);
    if (q) filter.name = new RegExp(escapeRegex(q), 'i');
    const items = await Team.find(filter)
      .select('name emoji visibility memberCount capacity hiddenByAdmin createdAt totalScore')
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    return { items: items.map((t) => ({ ...t, id: t._id.toString() })) };
  }

  async updateTeam(admin: AdminIdentity, rawId: string, body: { hiddenByAdmin?: boolean; archived?: boolean }) {
    const id = requireObjectId(rawId, 'TEAM_NOT_FOUND');
    const set: Record<string, unknown> = {};
    if (body.hiddenByAdmin !== undefined) set.hiddenByAdmin = body.hiddenByAdmin;
    if (body.archived) set.status = 'archived';
    const r = await Team.updateOne({ _id: id }, { $set: set });
    if (!r.matchedCount) throw notFound('TEAM_NOT_FOUND');
    await this.audit(admin, 'team.update', 'team', id, body);
    return { ok: true };
  }

  /* ---------- Audit ---------- */

  async auditLog() {
    const items = await AuditLog.find().sort({ createdAt: -1 }).limit(200).lean();
    return { items };
  }
}
