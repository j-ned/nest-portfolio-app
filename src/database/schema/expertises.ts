import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const expertiseTypeEnum = pgEnum('expertise_type', ['offer', 'seek']);

export const expertises = pgTable(
  'expertise',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    type: expertiseTypeEnum('type').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    typeIdx: index('expertise_type_idx').on(t.type),
  }),
);

export type Expertise = typeof expertises.$inferSelect;
export type NewExpertise = typeof expertises.$inferInsert;
export type ExpertiseType = (typeof expertiseTypeEnum.enumValues)[number];
