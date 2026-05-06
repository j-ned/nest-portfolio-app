import { pgTable, uuid, text } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { timestamps } from '../../common/utils';

export const socialLinks = pgTable('social_link', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  icon: text('icon').notNull(),
  label: text('label').notNull(),
  href: text('href').notNull(),
  ...timestamps(),
});

export type SocialLink = typeof socialLinks.$inferSelect;
export type NewSocialLink = typeof socialLinks.$inferInsert;
