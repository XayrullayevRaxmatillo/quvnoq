import { Body, Controller, Inject, Post } from '@nestjs/common';
import type { z } from 'zod';
import { reportSchema } from '../../shared';
import type { GuestSessionDoc } from '../../models/GuestSession';
import { Guest } from '../../common/decorators/guest.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ActionLimit } from '../../common/rate-limit/rate-limit.decorator';
import { ReportsService } from './reports.service';

@Controller('reports')
export class ReportsController {
  constructor(@Inject(ReportsService) private readonly reports: ReportsService) {}

  @Post()
  @ActionLimit(20, 60 * 60_000)
  create(@Guest() guest: GuestSessionDoc, @Body(new ZodValidationPipe(reportSchema)) body: z.output<typeof reportSchema>) {
    return this.reports.create(guest, body);
  }
}
