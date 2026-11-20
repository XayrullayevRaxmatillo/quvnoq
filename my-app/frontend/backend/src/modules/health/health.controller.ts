import { Controller, Get } from '@nestjs/common';
import mongoose from 'mongoose';
import { SkipApiLimit } from '../../common/rate-limit/rate-limit.decorator';

@Controller('health')
export class HealthController {
  @Get()
  @SkipApiLimit()
  health() {
    return { ok: true, db: mongoose.connection.readyState === 1, time: Date.now() };
  }
}
