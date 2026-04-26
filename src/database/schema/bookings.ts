import {
  pgTable,
  uuid,
  text,
  integer,
  date,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const bookings = pgTable(
  'booking',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    date: date('date', { mode: 'string' }).notNull(),
    startTime: text('start_time').notNull(),
    duration: integer('duration').notNull(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    phone: text('phone').notNull(),
    subject: text('subject').notNull(),
    message: text('message').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    dateIdx: index('booking_date_idx').on(t.date),
    createdAtIdx: index('booking_created_at_idx').on(t.createdAt),
  }),
);

export const disabledDates = pgTable('disabled_date', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  date: date('date', { mode: 'string' }).notNull().unique(),
  reason: text('reason'),
});

export type Booking = typeof bookings.$inferSelect;
export type NewBooking = typeof bookings.$inferInsert;
export type DisabledDate = typeof disabledDates.$inferSelect;
export type NewDisabledDate = typeof disabledDates.$inferInsert;
