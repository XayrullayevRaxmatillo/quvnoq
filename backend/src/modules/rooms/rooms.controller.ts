import { Body, Controller, Get, Inject, Param, Post } from '@nestjs/common';
import type { z } from 'zod';
import { roomCreateSchema } from '../../shared';
import type { GuestSessionDoc } from '../../models/GuestSession';
import { Guest } from '../../common/decorators/guest.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ActionLimit, IpLimit } from '../../common/rate-limit/rate-limit.decorator';
import { RoomsService } from './rooms.service';

@Controller('rooms')
export class RoomsController {
  constructor(@Inject(RoomsService) private readonly rooms: RoomsService) {}

  @Post()
  @ActionLimit(30, 60 * 60_000)
  create(@Guest() guest: GuestSessionDoc, @Body(new ZodValidationPipe(roomCreateSchema)) body: z.output<typeof roomCreateSchema>) {
    return this.rooms.create(guest, body);
  }

  @Get('public')
  listPublic() {
    return this.rooms.listPublic();
  }

  /** Anti brute-force for code guessing. */
  @Get(':code')
  @IpLimit(30, 60_000)
  get(@Param('code') code: string, @Guest() guest: GuestSessionDoc) {
    return this.rooms.get(code, guest);
  }

  @Get(':code/results')
  results(@Param('code') code: string, @Guest() guest: GuestSessionDoc) {
    return this.rooms.results(code, guest);
  }
}
