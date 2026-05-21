import { pgTable, uuid, text, boolean } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { timestamps } from '../../common/utils';

export const profile = pgTable('profile', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  displayName: text('display_name').notNull().default(''),
  location: text('location').notNull().default(''),
  avatarUrl: text('avatar_url').notNull().default(''),
  isAvailable: boolean('is_available').notNull().default(true),
  availabilityMessage: text('availability_message').notNull().default(''),
  ...timestamps(),
});

export type Profile = typeof profile.$inferSelect;
export type NewProfile = typeof profile.$inferInsert;
