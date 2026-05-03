import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, gte } from 'drizzle-orm';
import { isbot } from 'isbot';
import geoip from 'geoip-lite';
import { UAParser } from 'ua-parser-js';
import { DRIZZLE } from '../database/drizzle.constants';
import type { Database } from '../database/drizzle.types';
import { pageView, analyticsEvent } from '../database/schema/analytics';
import { TrackEventDto } from './dto/track-event.dto';

@Injectable()
export class AnalyticsTrackerService {
  private readonly logger = new Logger(AnalyticsTrackerService.name);

  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * Track une page-view ou un custom event. Ne throw JAMAIS — toute erreur
   * interne est loggée et avalée pour ne pas bloquer le client.
   */
  async track(dto: TrackEventDto, ip: string, ua: string): Promise<void> {
    try {
      // 1. Bot filter
      if (isbot(ua)) {
        return;
      }

      // 2. Session hash déterministe par jour (UTC)
      const day = new Date().toISOString().slice(0, 10);
      const sessionHash = createHash('sha256')
        .update(`${ip}|${ua}|${day}`)
        .digest('hex');

      // 3. UA parsing
      const parsed = new UAParser(ua).getResult();
      const browser =
        parsed.browser.name && parsed.browser.version
          ? `${parsed.browser.name} ${parsed.browser.version}`
          : null;
      const os =
        parsed.os.name && parsed.os.version
          ? `${parsed.os.name} ${parsed.os.version}`
          : null;

      // 4. Géoloc IP
      const country = geoip.lookup(ip)?.country ?? null;

      // 5. Branch : page-view vs custom event (via dto.type)
      if (dto.type === 'page_view' || dto.type === 'page_duration') {
        await this.upsertPageView(dto, sessionHash, browser, os, country);
      } else {
        await this.insertCustomEvent(dto, sessionHash);
      }
    } catch (err) {
      const e = err as Error & { cause?: Error };
      const causeMsg = e.cause?.message ? ` | cause: ${e.cause.message}` : '';
      this.logger.error(`track failed: ${e.message}${causeMsg}`, e.stack);
    }
  }

  private async upsertPageView(
    dto: TrackEventDto,
    sessionHash: string,
    browser: string | null,
    os: string | null,
    country: string | null,
  ): Promise<void> {
    const todayStart = new Date(
      `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`,
    );
    const [existing] = await this.db
      .select()
      .from(pageView)
      .where(
        and(
          eq(pageView.sessionHash, sessionHash),
          eq(pageView.url, dto.url!),
          gte(pageView.createdAt, todayStart),
        ),
      )
      .limit(1);

    if (existing) {
      const newDuration = (existing.duration ?? 0) + (dto.duration ?? 0);
      await this.db
        .update(pageView)
        .set({ duration: newDuration })
        .where(eq(pageView.id, existing.id))
        .returning();
      return;
    }

    await this.db
      .insert(pageView)
      .values({
        sessionHash,
        url: dto.url!,
        referrer: dto.referrer ?? null,
        browser,
        os,
        country,
        duration: dto.duration ?? null,
      })
      .returning();
  }

  private async insertCustomEvent(
    dto: TrackEventDto,
    sessionHash: string,
  ): Promise<void> {
    await this.db
      .insert(analyticsEvent)
      .values({
        sessionHash,
        eventType: dto.type,
        entityId: dto.entityId ?? null,
        entityTitle: dto.entityTitle ?? null,
        metadata: dto.metadata ?? null,
      })
      .returning();
  }
}
