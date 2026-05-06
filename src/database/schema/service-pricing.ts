import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { timestamps } from '../../common/utils';

export const servicePricing = pgTable(
  'service_pricing',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    title: text('title').notNull(),
    description: text('description').notNull(),
    price: text('price').notNull(),
    features: text('features')
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    highlighted: boolean('highlighted').notNull().default(false),
    enabled: boolean('enabled').notNull().default(true),
    order: integer('order').notNull().default(0),
    ...timestamps(),
  },
  (t) => ({
    orderIdx: index('service_pricing_order_idx').on(t.order),
  }),
);

export type ServicePricing = typeof servicePricing.$inferSelect;
export type NewServicePricing = typeof servicePricing.$inferInsert;
