import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { IoAdapter } from '@nestjs/platform-socket.io';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { env } from './config/env';
import { AppModule } from './app.module';

/** Turns body-parser errors (bad JSON, too large) into the API's JSON error shape. */
function bodyParserErrors(err: unknown, _req: Request, res: Response, next: NextFunction): void {
  const e = err as { type?: string } | null;
  if (e?.type === 'entity.too.large') {
    res.status(413).json({ error: { code: 'BAD_REQUEST', message: 'Payload too large' } });
    return;
  }
  if (e?.type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON' } });
    return;
  }
  next(err);
}

/** Builds the configured (not yet listening) NestJS application. Shared by main.ts and tests. */
export async function createApp(): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
    logger: env.NODE_ENV === 'test' ? ['error', 'warn'] : ['log', 'error', 'warn']
  });

  app.disable('x-powered-by');
  if (env.TRUST_PROXY > 0) app.set('trust proxy', env.TRUST_PROXY);

  // The backend only serves JSON + WebSockets; the frontend is deployed separately.
  app.use(
    helmet({
      contentSecurityPolicy: { useDefaults: true, directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'same-site' }
    })
  );
  app.use(compression());
  app.enableCors({ origin: env.clientOrigins, credentials: true });
  app.use(cookieParser());
  app.use(express.json({ limit: '1mb' }));
  app.use(bodyParserErrors);

  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  app.useWebSocketAdapter(new IoAdapter(app));
  app.enableShutdownHooks();
  return app;
}
