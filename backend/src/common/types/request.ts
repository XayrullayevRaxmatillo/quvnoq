import type { Request } from 'express';
import type { GuestSessionDoc } from '../../models/GuestSession';

/** Express request after SessionMiddleware / AdminGuard have run. */
export interface AppRequest extends Request {
  guest: GuestSessionDoc;
  admin?: { id: string; username: string };
}
