import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const socialLinks = pgTable('social_link', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  icon: text('icon').notNull(),
  label: text('label').notNull(),
  href: text('href').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type SocialLink = typeof socialLinks.$inferSelect;
export type NewSocialLink = typeof socialLinks.$inferInsert;
