import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { connectDb, disconnectDb } from '../config/db';
import { bootstrap } from '../services/bootstrap';
import { games } from '../game/manager';

/**
 * MongoDB lifecycle:
 *  - onModuleInit: connect (embedded MongoDB in dev when MONGODB_URI is empty)
 *  - onApplicationBootstrap: seed official content / first admin, mark stale rooms inactive
 *  - onApplicationShutdown: disconnect
 */
@Injectable()
export class DatabaseService implements OnModuleInit, OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Database');

  async onModuleInit(): Promise<void> {
    await connectDb();
  }

  async onApplicationBootstrap(): Promise<void> {
    await bootstrap();
    await games.deactivateStale();
    this.logger.log('Database ready');
  }

  async onApplicationShutdown(): Promise<void> {
    await disconnectDb().catch(() => undefined);
  }
}
