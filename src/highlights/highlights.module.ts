import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { HighlightsController } from './highlights.controller';
import { HomeHighlightsController } from './home-highlights.controller';
import { HighlightsService } from './highlights.service';

@Module({
  imports: [AuthModule],
  controllers: [HighlightsController, HomeHighlightsController],
  providers: [HighlightsService],
  exports: [HighlightsService],
})
export class HighlightsModule {}
