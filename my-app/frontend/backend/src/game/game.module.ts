import { BeforeApplicationShutdown, Global, Inject, Injectable, Module } from '@nestjs/common';
import { GameManager, games } from './manager';

/** Stops all in-memory game rooms and timers before the HTTP server and DB close. */
@Injectable()
export class GameLifecycle implements BeforeApplicationShutdown {
  constructor(@Inject(GameManager) private readonly manager: GameManager) {}

  beforeApplicationShutdown(): void {
    this.manager.shutdown();
  }
}

/**
 * The in-memory game state (rooms, timers) is a single process-wide GameManager.
 * It is exposed to Nest DI under its class token.
 */
@Global()
@Module({
  providers: [{ provide: GameManager, useValue: games }, GameLifecycle],
  exports: [GameManager]
})
export class GameModule {}
