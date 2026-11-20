import type { ZodTypeAny, z } from 'zod';
import mongoose from 'mongoose';
import type { ErrorCode } from '../shared';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: ErrorCode,
    message?: string,
    public details?: unknown
  ) {
    super(message ?? code);
  }
}

export const notFound = (code: ErrorCode = 'NOT_FOUND') => new ApiError(404, code);
export const forbidden = (code: ErrorCode = 'FORBIDDEN') => new ApiError(403, code);
export const badRequest = (code: ErrorCode = 'BAD_REQUEST', details?: unknown) => new ApiError(400, code, undefined, details);
export const conflict = (code: ErrorCode) => new ApiError(409, code);

export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ApiError(400, 'VALIDATION', 'Validation failed', result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  }
  return result.data;
}

export function isObjectId(id: unknown): id is string {
  return typeof id === 'string' && /^[a-f0-9]{24}$/i.test(id) && mongoose.isValidObjectId(id);
}

export function requireObjectId(id: unknown, code: ErrorCode = 'NOT_FOUND'): string {
  if (!isObjectId(id)) throw notFound(code);
  return id;
}

export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
