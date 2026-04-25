import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { sql } from 'drizzle-orm';
import { DRIZZLE } from '../database/drizzle.constants';
import type { Database } from '../database/drizzle.types';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  private readonly bootedAt = Date.now();

  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  @Get()
  @ApiOperation({ summary: 'Liveness + DB connectivity check' })
  @ApiResponse({
    status: 200,
    description: 'Service up; check db.status field',
  })
  async check() {
    const start = Date.now();
    let dbStatus: 'up' | 'down' = 'down';
    let dbLatencyMs: number | null = null;
    try {
      await this.db.execute(sql`SELECT 1`);
      dbStatus = 'up';
      dbLatencyMs = Date.now() - start;
    } catch {
      // status:'degraded' renvoyé en 200 plutôt que 503 — distingue
      // "app vivante / DB plantée" d'un service injoignable.
    }
    return {
      status: dbStatus === 'up' ? 'ok' : 'degraded',
      db: { status: dbStatus, latencyMs: dbLatencyMs },
      uptime: Math.round((Date.now() - this.bootedAt) / 1000),
      version: process.env.npm_package_version ?? 'dev',
      timestamp: new Date().toISOString(),
    };
  }
}
