import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const cvFiles = pgTable(
  'cv_file',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    fileName: text('file_name').notNull(),
    fileKey: text('file_key').notNull().unique(),
    fileSize: integer('file_size').notNull(),
    mimeType: text('mime_type').notNull().default('application/pdf'),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uploadedAtIdx: index('cv_file_uploaded_at_idx').on(t.uploadedAt),
  }),
);

export type CvFile = typeof cvFiles.$inferSelect;
export type NewCvFile = typeof cvFiles.$inferInsert;
