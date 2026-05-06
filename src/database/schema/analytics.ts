import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  date,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { timestamps } from '../../common/utils';

export const pageView = pgTable(
  'page_view',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    sessionHash: text('session_hash').notNull(),
    url: text('url').notNull(),
    referrer: text('referrer'),
    browser: text('browser'),
    os: text('os'),
    country: text('country'),
    duration: integer('duration'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    sessionHashIdx: index('page_view_session_hash_idx').on(t.sessionHash),
    createdAtIdx: index('page_view_created_at_idx').on(t.createdAt),
    urlIdx: index('page_view_url_idx').on(t.url),
  }),
);

export type PageView = typeof pageView.$inferSelect;
export type NewPageView = typeof pageView.$inferInsert;

export const analyticsEvent = pgTable(
  'analytics_event',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    sessionHash: text('session_hash').notNull(),
    eventType: text('event_type').notNull(),
    entityId: text('entity_id'),
    entityTitle: text('entity_title'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    sessionHashIdx: index('analytics_event_session_hash_idx').on(t.sessionHash),
    eventTypeCreatedIdx: index('analytics_event_type_created_idx').on(
      t.eventType,
      t.createdAt,
    ),
    entityIdx: index('analytics_event_entity_idx').on(t.eventType, t.entityId),
  }),
);

export type AnalyticsEvent = typeof analyticsEvent.$inferSelect;
export type NewAnalyticsEvent = typeof analyticsEvent.$inferInsert;

export const dailyStat = pgTable(
  'daily_stat',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    date: date('date', { mode: 'string' }).notNull().unique(),
    visitors: integer('visitors').notNull().default(0),
    pageviews: integer('pageviews').notNull().default(0),
    sessions: integer('sessions').notNull().default(0),
    bounces: integer('bounces').notNull().default(0),
    totalDuration: integer('total_duration').notNull().default(0),
    projectClicks: integer('project_clicks').notNull().default(0),
    articleViews: integer('article_views').notNull().default(0),
    cvDownloads: integer('cv_downloads').notNull().default(0),
    ...timestamps(),
  },
  (t) => ({
    dateIdx: index('daily_stat_date_idx').on(t.date),
  }),
);

export type DailyStat = typeof dailyStat.$inferSelect;
export type NewDailyStat = typeof dailyStat.$inferInsert;
