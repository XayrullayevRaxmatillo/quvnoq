import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { CATEGORY_SLUGS, LANGS, SKILL_LEVELS, teamInputSchema, teamUpdateSchema, type TeamInput } from '../../shared';
import type { GuestSessionDoc } from '../../models/GuestSession';
import { Guest } from '../../common/decorators/guest.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ActionLimit, IpLimit } from '../../common/rate-limit/rate-limit.decorator';
import { parse } from '../../utils/http';
import { TeamsService } from './teams.service';

const matchQuery = z.object({
  subject: z.enum(CATEGORY_SLUGS).optional(),
  language: z.enum(LANGS).optional(),
  level: z.enum(SKILL_LEVELS).optional()
});
const codeSchema = z.object({ code: z.string().min(6).max(12) }).strict();
const joinSchema = z.object({ code: z.string().max(12).optional() }).strict();
const pidSchema = z.object({ pid: z.string().min(1).max(32) }).strict();
const requestActionSchema = z.object({ action: z.enum(['accept', 'reject']) }).strict();

@Controller('teams')
export class TeamsController {
  constructor(@Inject(TeamsService) private readonly teams: TeamsService) {}

  /* ---------- Listing & discovery (static paths before /:id) ---------- */

  @Get()
  list(@Query() query: Record<string, unknown>) {
    return this.teams.list(query);
  }

  @Get('mine')
  mine(@Guest() guest: GuestSessionDoc) {
    return this.teams.mine(guest);
  }

  @Get('match')
  match(@Guest() guest: GuestSessionDoc, @Query() query: Record<string, unknown>) {
    const prefs = parse(matchQuery, {
      subject: query.subject || undefined,
      language: query.language || undefined,
      level: query.level || undefined
    });
    return this.teams.match(guest, prefs);
  }

  @Post()
  @ActionLimit(10, 60 * 60_000)
  create(@Guest() guest: GuestSessionDoc, @Body(new ZodValidationPipe(teamInputSchema)) input: TeamInput) {
    return this.teams.create(guest, input);
  }

  @Post('join-by-code')
  @HttpCode(200)
  @IpLimit(20, 60_000)
  joinByCode(@Guest() guest: GuestSessionDoc, @Body(new ZodValidationPipe(codeSchema)) body: z.output<typeof codeSchema>) {
    return this.teams.joinByCode(guest, body.code);
  }

  /* ---------- Single team ---------- */

  @Get(':id')
  get(@Param('id') id: string, @Guest() guest: GuestSessionDoc, @Query('code') code?: unknown) {
    return this.teams.get(id, guest, code);
  }

  @Post(':id/join')
  @HttpCode(200)
  @ActionLimit(30, 60 * 60_000)
  join(@Param('id') id: string, @Guest() guest: GuestSessionDoc, @Body(new ZodValidationPipe(joinSchema)) body: z.output<typeof joinSchema>) {
    return this.teams.join(id, guest, body.code);
  }

  @Post(':id/leave')
  @HttpCode(200)
  leave(@Param('id') id: string, @Guest() guest: GuestSessionDoc) {
    return this.teams.leave(id, guest);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Guest() guest: GuestSessionDoc,
    @Body(new ZodValidationPipe(teamUpdateSchema)) body: z.output<typeof teamUpdateSchema>
  ) {
    return this.teams.update(id, guest, body);
  }

  @Post(':id/kick')
  @HttpCode(200)
  kick(@Param('id') id: string, @Guest() guest: GuestSessionDoc, @Body(new ZodValidationPipe(pidSchema)) body: z.output<typeof pidSchema>) {
    return this.teams.kick(id, guest, body.pid);
  }

  @Post(':id/transfer')
  @HttpCode(200)
  transfer(@Param('id') id: string, @Guest() guest: GuestSessionDoc, @Body(new ZodValidationPipe(pidSchema)) body: z.output<typeof pidSchema>) {
    return this.teams.transfer(id, guest, body.pid);
  }

  @Post(':id/invite-code')
  @HttpCode(200)
  @ActionLimit(20, 60 * 60_000)
  inviteCode(@Param('id') id: string, @Guest() guest: GuestSessionDoc) {
    return this.teams.regenerateInviteCode(id, guest);
  }

  @Get(':id/requests')
  requests(@Param('id') id: string, @Guest() guest: GuestSessionDoc) {
    return this.teams.requests(id, guest);
  }

  @Post(':id/requests/:rid')
  @HttpCode(200)
  answerRequest(
    @Param('id') id: string,
    @Param('rid') rid: string,
    @Guest() guest: GuestSessionDoc,
    @Body(new ZodValidationPipe(requestActionSchema)) body: z.output<typeof requestActionSchema>
  ) {
    return this.teams.answerRequest(id, rid, guest, body.action);
  }
}
