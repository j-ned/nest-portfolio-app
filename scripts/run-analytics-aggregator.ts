/**
 * Standalone runner pour AnalyticsAggregatorService.manualRun().
 *
 * Usage:
 *   pnpm build && node dist/scripts/run-analytics-aggregator.js [YYYY-MM-DD]
 *
 * Si argument absent → agrège J-1.
 *
 * Note: tsx ne supporte pas emitDecoratorMetadata (requis par NestJS DI).
 * Compiler avec tsc (pnpm build) puis lancer le JS compilé.
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { AnalyticsAggregatorService } from '../src/analytics/analytics-aggregator.service';
import { subDays } from 'date-fns';

async function main(): Promise<void> {
  const arg = process.argv[2];
  const date = arg ? new Date(`${arg}T12:00:00Z`) : subDays(new Date(), 1);

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const service = app.get(AnalyticsAggregatorService);
  await service.manualRun(date);
  await app.close();
  process.exit(0);
}

void main();
