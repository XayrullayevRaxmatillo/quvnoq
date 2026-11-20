import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { ZodError } from 'zod';
import type { ErrorCode } from '../../shared';
import { ApiError } from '../../utils/http';

function codeForStatus(status: number): ErrorCode {
  if (status === 404) return 'NOT_FOUND';
  if (status === 429) return 'RATE_LIMITED';
  if (status === 403) return 'FORBIDDEN';
  if (status >= 400 && status < 500) return 'BAD_REQUEST';
  return 'INTERNAL';
}

/**
 * Every HTTP error leaves the API in one shape: { error: { code, message, details? } }.
 * The frontend relies on `error.code` for translated messages.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  catch(err: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') {
      // Socket handlers answer through their ack and never throw; just log anything unexpected.
      this.logger.error(err);
      return;
    }
    const res = host.switchToHttp().getResponse<Response>();
    if (res.headersSent) return;

    if (err instanceof ApiError) {
      res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
      return;
    }
    if (err instanceof ZodError) {
      res.status(400).json({ error: { code: 'VALIDATION', message: 'Validation failed', details: err.issues } });
      return;
    }
    if (err instanceof HttpException) {
      const status = err.getStatus();
      const message = status === 404 ? 'Not found' : err.message;
      res.status(status).json({ error: { code: codeForStatus(status), message } });
      return;
    }
    const e = err as { type?: string; code?: number } | null;
    if (e?.type === 'entity.too.large') {
      res.status(413).json({ error: { code: 'BAD_REQUEST', message: 'Payload too large' } });
      return;
    }
    if (e?.type === 'entity.parse.failed') {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON' } });
      return;
    }
    if (e?.code === 11000) {
      res.status(409).json({ error: { code: 'BAD_REQUEST', message: 'Duplicate' } });
      return;
    }
    this.logger.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Internal server error' } });
  }
}
