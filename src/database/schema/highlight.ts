import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const HIGHLIGHT_SECTIONS = ['profile', 'home'] as const;
export type HighlightSection = (typeof HIGHLIGHT_SECTIONS)[number];

export const highlight = pgTable(
  'highlight',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    title: text('title').notNull(),
    description: text('description').notNull(),
    icon: text('icon').notNull(),
    section: text('section')
      .$type<HighlightSection>()
      .notNull()
      .default('profile'),
    order: integer('order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('idx_highlight_section').on(table.section),
    index('idx_highlight_order').on(table.order),
  ],
);

export type Highlight = typeof highlight.$inferSelect;
export type NewHighlight = typeof highlight.$inferInsert;
