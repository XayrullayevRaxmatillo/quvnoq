import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { env } from './config/env';
import { createApp } from './app.factory';

async function main() {
  const app = await createApp();
  await app.listen(env.PORT, '0.0.0.0');
  Logger.log(`🚀 UZUZ backend (NestJS) listening on http://localhost:${env.PORT} (${env.NODE_ENV})`, 'Bootstrap');
  Logger.log(`   REST: /api/v1/*   WebSocket: /socket.io   Health: /health`, 'Bootstrap');
  Logger.log(`   Allowed frontend origins: ${env.clientOrigins.join(', ')}`, 'Bootstrap');
}

main().catch((err) => {
  console.error('❌ Failed to start server:', err);
  process.exit(1);
});
