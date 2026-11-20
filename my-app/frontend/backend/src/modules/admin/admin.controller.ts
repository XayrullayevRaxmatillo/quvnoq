import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { CATEGORY_SLUGS } from '../../shared';
import { CurrentAdmin } from '../../common/decorators/guest.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { IpLimit } from '../../common/rate-limit/rate-limit.decorator';
import { ADMIN_COOKIE, AdminGuard, adminCookieOptions } from '../../common/guards/admin.guard';
import type { AppRequest } from '../../common/types/request';
import { notFound } from '../../utils/http';
import { AdminService, type AdminIdentity } from './admin.service';

const loginSchema = z.object({ username: z.string().min(1).max(50), password: z.string().min(1).max(200) }).strict();
const quizPatchSchema = z.object({ hidden: z.boolean().optional(), featured: z.boolean().optional() }).strict();
const reportPatchSchema = z.object({ status: z.enum(['open', 'resolved', 'dismissed']), hideTarget: z.boolean().optional() }).strict();
const teamPatchSchema = z.object({ hiddenByAdmin: z.boolean().optional(), archived: z.boolean().optional() }).strict();
const categoryBody = z
  .object({
    name: z.object({ uz: z.string().min(1).max(40), ru: z.string().min(1).max(40), en: z.string().min(1).max(40) }).strict(),
    icon: z.string().min(1).max(8),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    order: z.number().int().min(0).max(100)
  })
  .strict();

/** Admin panel API. Uses its own cookie and does not create guest sessions. */
@Controller('admin')
export class AdminController {
  constructor(@Inject(AdminService) private readonly admin: AdminService) {}

  /* ---------- Auth ---------- */

  @Post('login')
  @HttpCode(200)
  @IpLimit(5, 15 * 60_000)
  async login(@Body(new ZodValidationPipe(loginSchema)) body: z.output<typeof loginSchema>, @Res({ passthrough: true }) res: Response) {
    const { username, token } = await this.admin.login(body.username, body.password);
    res.cookie(ADMIN_COOKIE, token, adminCookieOptions());
    return { username };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    await this.admin.logout(req.cookies?.[ADMIN_COOKIE] as string | undefined);
    res.clearCookie(ADMIN_COOKIE, { ...adminCookieOptions(), maxAge: undefined });
    return { ok: true };
  }

  @Get('me')
  @UseGuards(AdminGuard)
  me(@CurrentAdmin() admin: AdminIdentity) {
    return { username: admin.username };
  }

  /* ---------- Dashboard ---------- */

  @Get('stats')
  @UseGuards(AdminGuard)
  stats() {
    return this.admin.stats();
  }

  /* ---------- Quizzes ---------- */

  @Get('quizzes')
  @UseGuards(AdminGuard)
  quizzes(@Query() query: Record<string, unknown>) {
    return this.admin.quizzes(query);
  }

  @Patch('quizzes/:id')
  @UseGuards(AdminGuard)
  updateQuiz(@CurrentAdmin() admin: AdminIdentity, @Param('id') id: string, @Body(new ZodValidationPipe(quizPatchSchema)) body: z.output<typeof quizPatchSchema>) {
    return this.admin.updateQuiz(admin, id, body);
  }

  @Delete('quizzes/:id')
  @UseGuards(AdminGuard)
  deleteQuiz(@CurrentAdmin() admin: AdminIdentity, @Param('id') id: string) {
    return this.admin.deleteQuiz(admin, id);
  }

  /* ---------- Reports ---------- */

  @Get('reports')
  @UseGuards(AdminGuard)
  reports(@Query('status') status?: string) {
    return this.admin.reports(status);
  }

  @Patch('reports/:id')
  @UseGuards(AdminGuard)
  updateReport(@CurrentAdmin() admin: AdminIdentity, @Param('id') id: string, @Body(new ZodValidationPipe(reportPatchSchema)) body: z.output<typeof reportPatchSchema>) {
    return this.admin.updateReport(admin, id, body);
  }

  /* ---------- Categories ---------- */

  @Get('categories')
  @UseGuards(AdminGuard)
  categories() {
    return this.admin.categories();
  }

  @Put('categories/:slug')
  @UseGuards(AdminGuard)
  upsertCategory(@CurrentAdmin() admin: AdminIdentity, @Param('slug') slug: string, @Body() raw: unknown) {
    if (!(CATEGORY_SLUGS as readonly string[]).includes(slug)) throw notFound();
    const body = new ZodValidationPipe(categoryBody).transform(raw);
    return this.admin.upsertCategory(admin, slug, body);
  }

  /* ---------- Teams ---------- */

  @Get('teams')
  @UseGuards(AdminGuard)
  teams(@Query() query: Record<string, unknown>) {
    return this.admin.teams(query);
  }

  @Patch('teams/:id')
  @UseGuards(AdminGuard)
  updateTeam(@CurrentAdmin() admin: AdminIdentity, @Param('id') id: string, @Body(new ZodValidationPipe(teamPatchSchema)) body: z.output<typeof teamPatchSchema>) {
    return this.admin.updateTeam(admin, id, body);
  }

  /* ---------- Audit ---------- */

  @Get('audit')
  @UseGuards(AdminGuard)
  audit() {
    return this.admin.auditLog();
  }
}
