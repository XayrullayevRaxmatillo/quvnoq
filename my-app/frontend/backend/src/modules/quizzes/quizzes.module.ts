import { Module } from '@nestjs/common';
import { CategoriesController, QuizzesController } from './quizzes.controller';
import { QuizzesService } from './quizzes.service';

@Module({
  controllers: [CategoriesController, QuizzesController],
  providers: [QuizzesService],
  exports: [QuizzesService]
})
export class QuizzesModule {}
