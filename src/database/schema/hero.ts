import { pgTable, uuid, text } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { timestamps } from '../../common/utils';

export const hero = pgTable('hero', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  name: text('name').notNull().default(''),
  tagline: text('tagline').notNull().default(''),
  availability: text('availability').notNull().default(''),
  ...timestamps(),
});

export type Hero = typeof hero.$inferSelect;
export type NewHero = typeof hero.$inferInsert;
