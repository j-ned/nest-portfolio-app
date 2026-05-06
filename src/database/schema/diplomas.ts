import { pgTable, uuid, text } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { timestamps } from '../../common/utils';

export const diplomas = pgTable('diploma', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  title: text('title').notNull(),
  provider: text('provider').notNull(),
  shortDescription: text('short_description').notNull(),
  skills: text('skills')
    .array()
    .notNull()
    .default(sql`ARRAY[]::text[]`),
  ...timestamps(),
});

export type Diploma = typeof diplomas.$inferSelect;
export type NewDiploma = typeof diplomas.$inferInsert;
