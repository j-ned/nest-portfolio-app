import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { DRIZZLE } from '../database/drizzle.constants';
import type { Database } from '../database/drizzle.types';
import { users, type User } from '../database/schema/users';

@Injectable()
export class UsersService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async findById(id: string): Promise<User | null> {
    const rows = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    return rows[0] ?? null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const rows = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    return rows[0] ?? null;
  }

  async updatePassword(id: string, passwordHash: string): Promise<void> {
    await this.db.update(users)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(users.id, id));
  }

  async updateTwoFactorSecret(id: string, secret: string): Promise<void> {
    await this.db.update(users)
      .set({ twoFactorSecret: secret, updatedAt: new Date() })
      .where(eq(users.id, id));
  }

  async enableTwoFactor(id: string, backupCodesHash: string[]): Promise<void> {
    await this.db.update(users)
      .set({
        isTwoFactorEnabled: true,
        twoFactorBackupCodesHash: backupCodesHash,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id));
  }

  async disableTwoFactor(id: string): Promise<void> {
    await this.db.update(users)
      .set({
        isTwoFactorEnabled: false,
        twoFactorSecret: null,
        twoFactorBackupCodesHash: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id));
  }

  async replaceBackupCodes(id: string, backupCodesHash: string[]): Promise<void> {
    await this.db.update(users)
      .set({ twoFactorBackupCodesHash: backupCodesHash, updatedAt: new Date() })
      .where(eq(users.id, id));
  }

  async consumeBackupCode(id: string, hashToRemove: string): Promise<void> {
    // Postgres array_remove() retire toutes les occurrences ; comme les hashes Argon2 incluent
    // un sel aléatoire, chaque hash est unique → array_remove est safe.
    await this.db.update(users)
      .set({
        twoFactorBackupCodesHash: sql`array_remove(${users.twoFactorBackupCodesHash}, ${hashToRemove})`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id));
  }
}
