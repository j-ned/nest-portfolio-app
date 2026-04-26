import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsTrackerService } from './analytics-tracker.service';
import { AnalyticsStatsService } from './analytics-stats.service';
import { AnalyticsAggregatorService } from './analytics-aggregator.service';

@Module({
  imports: [AuthModule],
  controllers: [AnalyticsController],
  providers: [
    AnalyticsTrackerService,
    AnalyticsStatsService,
    AnalyticsAggregatorService,
  ],
  exports: [AnalyticsAggregatorService], // exporté pour le standalone script du Task 7
})
export class AnalyticsModule {}
