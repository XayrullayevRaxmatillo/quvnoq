import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Response } from 'express';
import { SESSION_TTL_MS } from '../../models/GuestSession';
import type { AppRequest } from '../types/request';
import { SESSION_COOKIE, createSession, findSessionByToken, setSessionCookie } from './session.service';

const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Server-issued guest session. Creates one on the first API call, refreshes the sliding
 * 30-day expiry at most once per hour.
 */
@Injectable()
export class SessionMiddleware implements NestMiddleware {
  async use(req: AppRequest, res: Response, next: NextFunction): Promise<void> {
    // Errors thrown here are handled by the global AllExceptionsFilter.
    const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
    let session = await findSessionByToken(token);
    if (!session) {
      const created = await createSession();
      session = created.session;
      setSessionCookie(res, created.token);
    } else if (Date.now() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      session.lastSeenAt = new Date();
      session.expiresAt = new Date(Date.now() + SESSION_TTL_MS);
      await session.save();
      setSessionCookie(res, token!);
    }
    req.guest = session;
    next();
  }
}
