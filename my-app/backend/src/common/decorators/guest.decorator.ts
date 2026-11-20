import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AppRequest } from '../types/request';

/** The current guest session (set by SessionMiddleware). */
export const Guest = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<AppRequest>().guest;
});

/** The logged-in admin (set by AdminGuard). */
export const CurrentAdmin = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<AppRequest>().admin!;
});
