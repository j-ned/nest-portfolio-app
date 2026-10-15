import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import { AppConfigService } from '../config/app-config.service';
import { DRIZZLE } from '../database/drizzle.constants';
import type { Database } from '../database/drizzle.types';
import {
  BOOKING_SETTING_ROW_ID,
  bookings,
  bookingSettings,
} from '../database/schema';
import { BOOKING_FEED, parseFeedFile, toFeedEvent } from './booking-feed';
import { BOOKING_POLICY } from './booking-policy';
import {
  createFeedSalt,
  deriveFeedToken,
  feedTokenMatches,
} from './feed-token';
import { toIcsFeed } from './to-ics';

export type FeedSubscription =
  | { status: 'unconfigured' }
  | { status: 'none' }
  | { status: 'active'; token: string; createdAt: string };

/**
 * Abonnement d'agenda des rendez-vous (ADR-0028). Le jeton est dérivé du secret et du sel à
 * chaque lecture, jamais stocké ni envoyé en paramètre SQL.
 */
@Injectable()
export class BookingFeedService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly config: AppConfigService,
  ) {}

  /** Flux iCalendar, ou `null` pour tout refus (secret absent, fichier malformé, aucun lien, jeton faux). */
  async renderFeed(file: string): Promise<string | null> {
    const secret = this.config.bookingFeedSecret;
    const token = parseFeedFile(file);
    if (!secret || !token) return null;

    const [setting] = await this.db
      .select({ feedSalt: bookingSettings.feedSalt })
      .from(bookingSettings)
      .where(eq(bookingSettings.id, BOOKING_SETTING_ROW_ID))
      .limit(1);
    if (!setting?.feedSalt) return null;
    if (!feedTokenMatches(token, deriveFeedToken(secret, setting.feedSalt))) {
      return null;
    }

    // Même borne que la purge nocturne : le flux montre ce que la purge n'a pas encore supprimé.
    const rows = await this.db
      .select()
      .from(bookings)
      .where(
        and(
          eq(bookings.status, 'confirmed'),
          gt(
            bookings.endsAt,
            sql`now() - make_interval(months => ${BOOKING_POLICY.retentionMonths})`,
          ),
        ),
      )
      .orderBy(asc(bookings.startsAt));
    const siteUrl = this.config.publicSiteUrl.replace(/\/+$/, '');
    return toIcsFeed({
      name: BOOKING_FEED.calendarName,
      refreshMinutes: BOOKING_FEED.refreshMinutes,
      events: rows.map((row) => toFeedEvent(row, siteUrl)),
    });
  }

  /** Nouveau sel : l'ancien lien cesse de fonctionner dès la requête suivante. */
  async regenerate(): Promise<FeedSubscription & { status: 'active' }> {
    const secret = this.config.bookingFeedSecret;
    if (!secret) {
      throw new ConflictException({
        error: 'feed_not_configured',
        message: 'Abonnement non configuré.',
      });
    }
    const feedSalt = createFeedSalt();
    const feedCreatedAt = new Date();
    // Le défaut des fériés ne joue qu'à la création de la ligne : une ligne existante garde son réglage.
    const [row] = await this.db
      .insert(bookingSettings)
      .values({ id: BOOKING_SETTING_ROW_ID, feedSalt, feedCreatedAt })
      .onConflictDoUpdate({
        target: bookingSettings.id,
        set: { feedSalt, feedCreatedAt, updatedAt: feedCreatedAt },
      })
      .returning({ feedCreatedAt: bookingSettings.feedCreatedAt });
    return {
      status: 'active',
      token: deriveFeedToken(secret, feedSalt),
      createdAt: (row.feedCreatedAt ?? feedCreatedAt).toISOString(),
    };
  }
}
