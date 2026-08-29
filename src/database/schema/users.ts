import { pgTable, uuid, text, boolean, integer } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { timestamps } from '../../common/utils';

export const users = pgTable('users', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  isTwoFactorEnabled: boolean('is_two_factor_enabled').notNull().default(false),
  twoFactorSecret: text('two_factor_secret'),
  twoFactorBackupCodesHash: text('two_factor_backup_codes_hash').array(),
  // Incrémenté au changement de password / activation-désactivation 2FA.
  // Un JWT dont le tokenVersion diverge de celui en DB est rejeté (JwtStrategy) :
  // révoque tous les tokens émis avant le changement, sans état de session à gérer.
  tokenVersion: integer('token_version').notNull().default(0),
  ...timestamps(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
