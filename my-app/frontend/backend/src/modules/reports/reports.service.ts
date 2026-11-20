import { Injectable } from '@nestjs/common';
import mongoose from 'mongoose';
import type { z } from 'zod';
import type { reportSchema } from '../../shared';
import { Report } from '../../models/misc';
import { Quiz } from '../../models/Quiz';
import { Team } from '../../models/Team';
import type { GuestSessionDoc } from '../../models/GuestSession';
import { notFound } from '../../utils/http';

@Injectable()
export class ReportsService {
  async create(guest: GuestSessionDoc, body: z.output<typeof reportSchema>) {
    let label = '';
    if (body.targetType === 'quiz') {
      if (!mongoose.isValidObjectId(body.targetId)) throw notFound('QUIZ_NOT_FOUND');
      const q = await Quiz.findById(body.targetId).select('title');
      if (!q) throw notFound('QUIZ_NOT_FOUND');
      label = q.title;
    } else if (body.targetType === 'team') {
      if (!mongoose.isValidObjectId(body.targetId)) throw notFound('TEAM_NOT_FOUND');
      const t = await Team.findById(body.targetId).select('name');
      if (!t) throw notFound('TEAM_NOT_FOUND');
      label = t.name;
    } else {
      label = body.targetId; // player public id
    }
    const r = await Report.updateOne(
      { targetType: body.targetType, targetId: body.targetId, reporter: guest._id },
      { $setOnInsert: { targetLabel: label, reason: body.reason, details: body.details, status: 'open' } },
      { upsert: true }
    );
    if (r.upsertedCount && body.targetType === 'quiz') await Quiz.updateOne({ _id: body.targetId }, { $inc: { reportsCount: 1 } });
    return { ok: true };
  }
}
