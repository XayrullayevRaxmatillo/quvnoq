import type { CookieOptions, Response } from 'express';
import { env } from '../../config/env';
import { GuestSession, SESSION_TTL_MS, type GuestSessionDoc } from '../../models/GuestSession';
import { newPublicId, newToken, sha256 } from '../../utils/crypto';

export const SESSION_COOKIE = 'uzuz_sid';

export function sessionCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAMESITE,
    maxAge: SESSION_TTL_MS,
    path: '/'
  };
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions());
}

export async function findSessionByToken(token: string | undefined): Promise<GuestSessionDoc | null> {
  if (!token || token.length < 20 || token.length > 100) return null;
  const session = await GuestSession.findOne({ tokenHash: sha256(token) });
  if (!session || session.expiresAt.getTime() < Date.now()) return null;
  return session;
}

export async function createSession(): Promise<{ session: GuestSessionDoc; token: string }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const token = newToken();
    try {
      const session = await GuestSession.create({
        tokenHash: sha256(token),
        publicId: newPublicId(),
        avatar: Math.floor(Math.random() * 24),
        color: Math.floor(Math.random() * 8),
        expiresAt: new Date(Date.now() + SESSION_TTL_MS)
      });
      return { session, token };
    } catch (err) {
      if ((err as { code?: number }).code !== 11000) throw err;
    }
  }
  throw new Error('Could not create session');
}
