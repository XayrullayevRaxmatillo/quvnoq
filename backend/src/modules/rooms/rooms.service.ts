import { Inject, Injectable } from '@nestjs/common';
import type { z } from 'zod';
import { isValidRoomCode, normalizeRoomCode, type roomCreateSchema } from '../../shared';
import { Quiz } from '../../models/Quiz';
import { GameResult } from '../../models/GameResult';
import { PlayerStats } from '../../models/PlayerStats';
import type { GuestSessionDoc } from '../../models/GuestSession';
import { GameManager } from '../../game/manager';
import type { EngineQuiz } from '../../game/engine';
import { notFound } from '../../utils/http';

@Injectable()
export class RoomsService {
  constructor(@Inject(GameManager) private readonly games: GameManager) {}

  async create(guest: GuestSessionDoc, body: z.output<typeof roomCreateSchema>) {
    const quiz = await Quiz.findOne({ _id: body.quizId, hidden: false }).lean();
    if (!quiz) throw notFound('QUIZ_NOT_FOUND');

    const engineQuiz: EngineQuiz = {
      id: quiz._id.toString(),
      title: quiz.title,
      language: quiz.language,
      questions: quiz.questions.map((q) => ({
        type: q.type,
        text: q.text,
        image: q.image ?? null,
        options: q.options.map((o) => ({ text: o.text, correct: o.correct })),
        timeLimit: q.timeLimit,
        points: q.points ?? 'standard',
        explanation: q.explanation ?? ''
      }))
    };

    const room = await this.games.create({
      quiz: engineQuiz,
      mode: body.mode,
      settings: body.settings,
      hostSessionId: guest._id.toString(),
      hostPid: guest.publicId
    });
    return { code: room.code, mode: room.mode };
  }

  listPublic() {
    return { items: this.games.listPublic() };
  }

  get(rawCode: string, guest: GuestSessionDoc) {
    const code = normalizeRoomCode(String(rawCode));
    if (!isValidRoomCode(code)) throw notFound('ROOM_NOT_FOUND');
    const room = this.games.get(code);
    if (!room) throw notFound('ROOM_NOT_FOUND');
    const sid = guest._id.toString();
    return {
      code: room.code,
      phase: room.phase,
      mode: room.mode,
      quizTitle: room.quiz.title,
      questionCount: room.quiz.questions.length,
      language: room.quiz.language,
      playerCount: room.playerCount,
      maxPlayers: room.settings.maxPlayers,
      locked: room.locked,
      isHost: room.isHost(sid),
      isPlayer: room.isPlayer(sid)
    };
  }

  async results(rawCode: string, guest: GuestSessionDoc) {
    const code = normalizeRoomCode(String(rawCode));
    if (!isValidRoomCode(code)) throw notFound('ROOM_NOT_FOUND');
    const result = await GameResult.findOne({ roomCode: code }).sort({ finishedAt: -1 }).lean();
    if (!result) throw notFound('NOT_FOUND');
    const hidden = new Set(
      (
        await PlayerStats.find({ session: { $in: result.players.map((p) => p.session) }, nameHidden: true })
          .select('session')
          .lean()
      ).map((s) => s.session.toString())
    );
    const sid = guest._id.toString();
    return {
      roomCode: result.roomCode,
      quizTitle: result.quizTitle,
      quizSlug: result.quizSlug,
      mode: result.mode,
      questionCount: result.questionCount,
      playerCount: result.playerCount,
      finishedAt: result.finishedAt,
      players: result.players.slice(0, 100).map((p) => ({
        pid: p.pid,
        nickname: hidden.has(p.session.toString()) ? '•••' : p.nickname,
        avatar: p.avatar,
        color: p.color,
        score: p.score,
        correct: p.correct,
        rank: p.rank,
        teamKey: p.teamKey,
        isYou: p.session.toString() === sid
      })),
      teams: result.teams
    };
  }
}
