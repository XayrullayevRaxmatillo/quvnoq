import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { RateLimitGuard } from './common/rate-limit/rate-limit.guard';
import { SessionMiddleware } from './common/middleware/session.middleware';
import { DatabaseModule } from './database/database.module';
import { GameModule } from './game/game.module';
import { RealtimeModule } from './realtime/realtime.module';
import { HealthController } from './modules/health/health.controller';
import { SessionModule } from './modules/session/session.module';
import { SessionController } from './modules/session/session.controller';
import { QuizzesModule } from './modules/quizzes/quizzes.module';
import { CategoriesController, QuizzesController } from './modules/quizzes/quizzes.controller';
import { RoomsModule } from './modules/rooms/rooms.module';
import { RoomsController } from './modules/rooms/rooms.controller';
import { TeamsModule } from './modules/teams/teams.module';
import { TeamsController } from './modules/teams/teams.controller';
import { LeaderboardModule } from './modules/leaderboard/leaderboard.module';
import { LeaderboardController } from './modules/leaderboard/leaderboard.controller';
import { ImagesModule } from './modules/images/images.module';
import { ImagesController } from './modules/images/images.controller';
import { ReportsModule } from './modules/reports/reports.module';
import { ReportsController } from './modules/reports/reports.controller';
import { AdminModule } from './modules/admin/admin.module';

@Module({
  imports: [
    DatabaseModule,
    GameModule,
    RealtimeModule,
    SessionModule,
    QuizzesModule,
    RoomsModule,
    TeamsModule,
    LeaderboardModule,
    ImagesModule,
    ReportsModule,
    AdminModule
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter }
  ]
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Every guest-facing API route gets a server-issued guest session (cookie).
    // Admin and /health are deliberately excluded.
    consumer
      .apply(SessionMiddleware)
      .forRoutes(
        SessionController,
        CategoriesController,
        QuizzesController,
        RoomsController,
        TeamsController,
        LeaderboardController,
        ImagesController,
        ReportsController
      );
  }
}
