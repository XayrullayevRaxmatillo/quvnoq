import { Body, Controller, Get, HttpCode, Inject, Patch, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { sessionUpdateSchema } from '../../shared';
import type { GuestSessionDoc } from '../../models/GuestSession';
import { Guest } from '../../common/decorators/guest.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ActionLimit, IpLimit } from '../../common/rate-limit/rate-limit.decorator';
import { setSessionCookie } from '../../common/middleware/session.service';
import { SessionService } from './session.service';

const restoreSchema = z.object({ code: z.string().min(8).max(20) }).strict();

@Controller('session')
export class SessionController {
  constructor(@Inject(SessionService) private readonly sessions: SessionService) {}

  @Get()
  get(@Guest() guest: GuestSessionDoc) {
    return this.sessions.toDto(guest);
  }

  @Patch()
  @ActionLimit(30, 60_000)
  update(@Guest() guest: GuestSessionDoc, @Body(new ZodValidationPipe(sessionUpdateSchema)) body: z.output<typeof sessionUpdateSchema>) {
    return this.sessions.update(guest, body);
  }

  @Post('restore-code')
  @HttpCode(200)
  @ActionLimit(5, 60 * 60_000)
  restoreCode(@Guest() guest: GuestSessionDoc) {
    return this.sessions.createRestoreCode(guest);
  }

  @Post('restore')
  @HttpCode(200)
  @IpLimit(10, 15 * 60_000)
  async restore(@Body(new ZodValidationPipe(restoreSchema)) body: z.output<typeof restoreSchema>, @Res({ passthrough: true }) res: Response) {
    const { session, token } = await this.sessions.restore(body.code);
    setSessionCookie(res, token);
    return this.sessions.toDto(session);
  }

  @Get('history')
  history(@Guest() guest: GuestSessionDoc) {
    return this.sessions.history(guest);
  }
}
