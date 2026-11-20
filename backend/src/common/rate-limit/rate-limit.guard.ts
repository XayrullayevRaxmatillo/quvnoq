import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import { ApiError } from '../../utils/http';
import type { AppRequest } from '../types/request';
import { RATE_LIMIT_KEY, SKIP_API_LIMIT_KEY, type RateLimitRule } from './rate-limit.decorator';

interface Bucket {
  count: number;
  resetAt: number;
}

/** Whole API: 400 requests per minute per IP (same as before). */
const API_RULE: RateLimitRule = { limit: 400, windowMs: 60_000, by: 'ip' };

/**
 * In-memory fixed-window rate limiter.
 * Runs as a global guard: the API-wide per-IP limit for every route, plus a stricter
 * route limit declared with @ActionLimit / @IpLimit.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly buckets = new Map<string, Bucket>();

  constructor(@Inject(Reflector) private readonly reflector: Reflector) {
    const timer = setInterval(() => this.sweep(), 60_000);
    timer.unref();
  }

  canActivate(ctx: ExecutionContext): boolean {
    if (ctx.getType() !== 'http') return true;
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const targets = [ctx.getHandler(), ctx.getClass()];

    if (!this.reflector.getAllAndOverride<boolean>(SKIP_API_LIMIT_KEY, targets)) {
      this.hit('api', API_RULE, req, res);
    }
    const rule = this.reflector.getAllAndOverride<RateLimitRule | undefined>(RATE_LIMIT_KEY, targets);
    if (rule) {
      this.hit(`${ctx.getClass().name}.${ctx.getHandler().name}`, rule, req, res);
    }
    return true;
  }

  private hit(scope: string, rule: RateLimitRule, req: AppRequest, res: Response): void {
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    const who = rule.by === 'session' && req.guest ? `s:${req.guest._id.toString()}` : `ip:${ip}`;
    const key = `${scope}|${who}`;
    const now = Date.now();
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + rule.windowMs };
      this.buckets.set(key, bucket);
    }
    bucket.count++;
    const remaining = Math.max(0, rule.limit - bucket.count);
    const resetSec = Math.ceil((bucket.resetAt - now) / 1000);
    res.setHeader('RateLimit', `limit=${rule.limit}, remaining=${remaining}, reset=${resetSec}`);
    if (bucket.count > rule.limit) {
      res.setHeader('Retry-After', String(resetSec));
      throw new ApiError(429, 'RATE_LIMITED', 'Too many requests, slow down.');
    }
  }

  private sweep(): void {
    const now = Date.now();
    for (const [key, b] of this.buckets) if (b.resetAt <= now) this.buckets.delete(key);
  }
}
