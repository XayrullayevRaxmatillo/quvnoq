import { SetMetadata } from '@nestjs/common';

export type RateLimitKey = 'ip' | 'session';

export interface RateLimitRule {
  limit: number;
  windowMs: number;
  /** 'session' = per guest session (falls back to IP), 'ip' = per client IP. */
  by: RateLimitKey;
}

export const RATE_LIMIT_KEY = 'uzuz:rate-limit';
export const SKIP_API_LIMIT_KEY = 'uzuz:skip-api-limit';

/** Per-session limiter for expensive or abusable actions. Falls back to IP. */
export const ActionLimit = (limit: number, windowMs: number) =>
  SetMetadata(RATE_LIMIT_KEY, { limit, windowMs, by: 'session' } satisfies RateLimitRule);

/** Per-IP limiter (room code lookups — anti brute force; restore; admin login). */
export const IpLimit = (limit: number, windowMs: number) =>
  SetMetadata(RATE_LIMIT_KEY, { limit, windowMs, by: 'ip' } satisfies RateLimitRule);

/** Exclude a route from the global per-IP API limiter (e.g. /health). */
export const SkipApiLimit = () => SetMetadata(SKIP_API_LIMIT_KEY, true);
