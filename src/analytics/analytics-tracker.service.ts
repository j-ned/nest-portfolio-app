import { createHash } from 'node:crypto';
import { isIPv4, isIPv6 } from 'node:net';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, gte } from 'drizzle-orm';
import { isbot } from 'isbot';
import geoip from 'geoip-lite';
import { UAParser } from 'ua-parser-js';
import { DRIZZLE } from '../database/drizzle.constants';
import type { Database } from '../database/drizzle.types';
import { pageView, analyticsEvent } from '../database/schema';
import { TrackEventDto } from './dto/track-event.dto';

// RFC1918 + loopback + link-local + IPv6 ULA. Strips ::ffff: IPv4-mapped prefix.
export function isPrivateIp(raw: string): boolean {
  if (!raw) return false;

  const lower = raw.toLowerCase();
  const ip = lower.startsWith('::ffff:') ? lower.slice(7) : lower;

  if (isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 127 ||
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    );
  }

  if (isIPv6(ip)) {
    return (
      ip === '::1' ||
      /^fe[89ab][0-9a-f]/.test(ip) || // fe80::/10 link-local
      /^f[cd]/.test(ip) // fc00::/7 ULA
    );
  }

  return false;
}

function isExcludedUrl(url: string): boolean {
  return url === '/login' || url === '/admin' || url.startsWith('/admin/');
}

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
      if (isbot(ua)) {
        return;
      }

      if (isPrivateIp(ip)) {
        return;
      }

      if (
        (dto.type === 'page_view' || dto.type === 'page_duration') &&
        dto.url &&
        isExcludedUrl(dto.url)
      ) {
        return;
      }

      const day = new Date().toISOString().slice(0, 10);
      const sessionHash = createHash('sha256')
        .update(`${ip}|${ua}|${day}`)
        .digest('hex');

      const parsed = new UAParser(ua).getResult();
      const browser =
        parsed.browser.name && parsed.browser.version
          ? `${parsed.browser.name} ${parsed.browser.version}`
          : null;
      const os =
        parsed.os.name && parsed.os.version
          ? `${parsed.os.name} ${parsed.os.version}`
          : null;

      const country = geoip.lookup(ip)?.country ?? null;

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
        .where(eq(pageView.id, existing.id));
      return;
    }

    await this.db.insert(pageView).values({
      sessionHash,
      url: dto.url!,
      referrer: dto.referrer ?? null,
      browser,
      os,
      country,
      duration: dto.duration ?? null,
    });
  }

  private async insertCustomEvent(
    dto: TrackEventDto,
    sessionHash: string,
  ): Promise<void> {
    await this.db.insert(analyticsEvent).values({
      sessionHash,
      eventType: dto.type,
      entityId: dto.entityId ?? null,
      entityTitle: dto.entityTitle ?? null,
      metadata: dto.metadata ?? null,
    });
  }
}
