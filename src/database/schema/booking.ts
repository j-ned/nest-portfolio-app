import {
  boolean,
  check,
  date,
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { timestamps } from '../../common/utils';

/**
 * Plage hebdomadaire de disponibilité, en heure murale de Paris (ADR-0026 §2) : jour ISO 1-7,
 * minutes depuis minuit, fin exclusive.
 */
export const availabilityRules = pgTable(
  'availability_rule',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    weekday: smallint('weekday').notNull(),
    startMinute: smallint('start_minute').notNull(),
    endMinute: smallint('end_minute').notNull(),
    ...timestamps(),
  },
  (t) => ({
    weekdayCheck: check(
      'availability_rule_weekday_check',
      sql`${t.weekday} between 1 and 7`,
    ),
    rangeCheck: check(
      'availability_rule_range_check',
      sql`${t.startMinute} >= 0 and ${t.endMinute} <= 1440 and ${t.endMinute} > ${t.startMinute}`,
    ),
  }),
);

/** Fermeture : intervalle inclusif de dates de Paris (`YYYY-MM-DD`). */
export const availabilityClosures = pgTable(
  'availability_closure',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    startsOn: date('starts_on', { mode: 'string' }).notNull(),
    endsOn: date('ends_on', { mode: 'string' }).notNull(),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    rangeCheck: check(
      'availability_closure_range_check',
      sql`${t.endsOn} >= ${t.startsOn}`,
    ),
  }),
);

/** Seule ligne autorisée du réglage de la prise de rendez-vous. */
export const BOOKING_SETTING_ROW_ID = 'main';

/** Fériés fermés par défaut, y compris tant que la ligne du réglage n'existe pas (ADR-0027). */
export const DEFAULT_CLOSE_PUBLIC_HOLIDAYS = true;

/** Réglage de la prise de rendez-vous : une ligne (modèle `profile_content`). */
export const bookingSettings = pgTable(
  'booking_setting',
  {
    id: text('id').primaryKey().default(BOOKING_SETTING_ROW_ID),
    closePublicHolidays: boolean('close_public_holidays')
      .notNull()
      .default(DEFAULT_CLOSE_PUBLIC_HOLIDAYS),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    singleRow: check('booking_setting_single_row', sql`${t.id} = 'main'`),
  }),
);

/**
 * Exception d'un jour à la semaine type, en état souhaité (ADR-0027) : `closed` ferme un jour qui
 * serait ouvert, `open` rouvre un férié fermé par l'interrupteur. Jamais de ligne égale à la règle.
 */
export const availabilityOverrides = pgTable(
  'availability_override',
  {
    day: date('day', { mode: 'string' }).primaryKey(),
    kind: text('kind', { enum: ['open', 'closed'] }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    kindCheck: check(
      'availability_override_kind_check',
      sql`${t.kind} in ('open', 'closed')`,
    ),
  }),
);

/**
 * Rendez-vous : instants UTC (ADR-0026 §1). Le non-chevauchement des rendez-vous confirmés est
 * garanti par la contrainte d'exclusion `booking_no_overlap`, posée à la main par une migration
 * (drizzle-kit ne sait pas l'exprimer).
 */
export const bookings = pgTable(
  'booking',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    phone: text('phone'),
    company: text('company'),
    message: text('message').notNull(),
    format: text('format', { enum: ['video', 'phone'] }).notNull(),
    videoUrl: text('video_url'),
    status: text('status', { enum: ['confirmed', 'cancelled'] })
      .notNull()
      .default('confirmed'),
    cancelTokenHash: text('cancel_token_hash')
      .notNull()
      .unique('booking_cancel_token_hash_unique'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledBy: text('cancelled_by', { enum: ['visitor', 'owner'] }),
    cancelReason: text('cancel_reason'),
    reminderSentAt: timestamp('reminder_sent_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => ({
    startsAtIdx: index('booking_starts_at_idx').on(t.startsAt),
    rangeCheck: check('booking_range_check', sql`${t.endsAt} > ${t.startsAt}`),
    formatCheck: check(
      'booking_format_check',
      sql`${t.format} in ('video', 'phone')`,
    ),
    statusCheck: check(
      'booking_status_check',
      sql`${t.status} in ('confirmed', 'cancelled')`,
    ),
    videoCheck: check(
      'booking_video_check',
      sql`(${t.format} = 'video') = (${t.videoUrl} is not null)`,
    ),
    phoneCheck: check(
      'booking_phone_check',
      sql`${t.format} <> 'phone' or ${t.phone} is not null`,
    ),
    cancelCheck: check(
      'booking_cancel_check',
      sql`(${t.status} = 'cancelled') = (${t.cancelledAt} is not null) and (${t.cancelledBy} is null or ${t.cancelledBy} in ('visitor', 'owner'))`,
    ),
  }),
);

export type AvailabilityRule = typeof availabilityRules.$inferSelect;
export type AvailabilityClosure = typeof availabilityClosures.$inferSelect;
export type BookingSetting = typeof bookingSettings.$inferSelect;
export type AvailabilityOverride = typeof availabilityOverrides.$inferSelect;
export type Booking = typeof bookings.$inferSelect;
export type NewBooking = typeof bookings.$inferInsert;
