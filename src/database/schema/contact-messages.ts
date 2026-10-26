import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const contactMessages = pgTable(
  'contact_message',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    name: text('name').notNull(),
    email: text('email').notNull(),
    subject: text('subject').notNull(),
    message: text('message').notNull(),
    read: boolean('read').notNull().default(false),
    // Empreinte HMAC de l'IP (clé dérivée du secret JWT) : relie les messages d'un même
    // expéditeur sans conserver l'IP, donnée personnelle. Null pour les messages antérieurs.
    senderHash: text('sender_hash'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    readIdx: index('contact_message_read_idx').on(t.read),
    createdAtIdx: index('contact_message_created_at_idx').on(t.createdAt),
    readCreatedIdx: index('contact_message_read_created_idx').on(
      t.read,
      t.createdAt,
    ),
  }),
);

export type ContactMessage = typeof contactMessages.$inferSelect;
export type NewContactMessage = typeof contactMessages.$inferInsert;
