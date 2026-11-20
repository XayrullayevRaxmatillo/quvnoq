import { Controller, Get, Inject, Query } from '@nestjs/common';
import type { GuestSessionDoc } from '../../models/GuestSession';
import { Guest } from '../../common/decorators/guest.decorator';
import { LeaderboardService } from './leaderboard.service';

@Controller('leaderboard')
export class LeaderboardController {
  constructor(@Inject(LeaderboardService) private readonly leaderboard: LeaderboardService) {}

  /** ?scope=global|weekly|teams|quiz (&quizId=…) &page=N */
  @Get()
  get(@Query() query: Record<string, unknown>, @Guest() guest: GuestSessionDoc) {
    return this.leaderboard.get(query, guest);
  }
}
