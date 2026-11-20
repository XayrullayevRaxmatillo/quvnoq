import { Body, Controller, Delete, Get, Headers, Inject, Param, Post, Put, Query } from '@nestjs/common';
import type { z } from 'zod';
import { quizInputSchema, reportSchema, type QuizInput } from '../../shared';
import type { GuestSessionDoc } from '../../models/GuestSession';
import { Guest } from '../../common/decorators/guest.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ActionLimit } from '../../common/rate-limit/rate-limit.decorator';
import { QuizzesService } from './quizzes.service';

const quizReportSchema = reportSchema.omit({ targetType: true, targetId: true });

@Controller('categories')
export class CategoriesController {
  constructor(@Inject(QuizzesService) private readonly quizzes: QuizzesService) {}

  @Get()
  list() {
    return this.quizzes.categories();
  }
}

@Controller('quizzes')
export class QuizzesController {
  constructor(@Inject(QuizzesService) private readonly quizzes: QuizzesService) {}

  @Get()
  list(@Query() query: Record<string, unknown>) {
    return this.quizzes.list(query);
  }

  @Get('mine')
  mine(@Guest() guest: GuestSessionDoc) {
    return this.quizzes.mine(guest);
  }

  @Get('by-slug/:slug')
  bySlug(@Param('slug') slug: string, @Guest() guest: GuestSessionDoc, @Headers('x-edit-key') editKey?: string) {
    return this.quizzes.bySlug(slug, { guest, editKey });
  }

  @Get(':id/edit')
  forEdit(@Param('id') id: string, @Guest() guest: GuestSessionDoc, @Headers('x-edit-key') editKey?: string) {
    return this.quizzes.forEdit(id, { guest, editKey });
  }

  @Post()
  @ActionLimit(20, 60 * 60_000)
  create(@Guest() guest: GuestSessionDoc, @Body(new ZodValidationPipe(quizInputSchema)) input: QuizInput) {
    return this.quizzes.create(guest, input);
  }

  @Put(':id')
  @ActionLimit(60, 60 * 60_000)
  update(
    @Param('id') id: string,
    @Guest() guest: GuestSessionDoc,
    @Body(new ZodValidationPipe(quizInputSchema)) input: QuizInput,
    @Headers('x-edit-key') editKey?: string
  ) {
    return this.quizzes.update(id, { guest, editKey }, input);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Guest() guest: GuestSessionDoc, @Headers('x-edit-key') editKey?: string) {
    return this.quizzes.remove(id, { guest, editKey });
  }

  @Post(':id/report')
  @ActionLimit(20, 60 * 60_000)
  report(@Param('id') id: string, @Guest() guest: GuestSessionDoc, @Body(new ZodValidationPipe(quizReportSchema)) body: z.output<typeof quizReportSchema>) {
    return this.quizzes.report(id, guest, body);
  }
}
