import 'dotenv/config';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import argon2 from 'argon2';
import { eq, sql } from 'drizzle-orm';
import { users } from '../schema';

async function main() {
  const url = process.env.DATABASE_URL;
  const [email, newPassword] = process.argv.slice(2);
  if (!url) throw new Error('Missing DATABASE_URL in env');
  if (!email || !newPassword) {
    throw new Error(
      'Usage: pnpm db:change-password <email> <newPassword> (newPassword must be 12+ chars)',
    );
  }
  if (newPassword.length < 12) {
    throw new Error('newPassword must be at least 12 characters');
  }

  const client = postgres(url, { max: 1 });
  const db = drizzle(client);
  try {
    const passwordHash = await argon2.hash(newPassword);
    const [row] = await db
      .update(users)
      .set({ passwordHash, tokenVersion: sql`${users.tokenVersion} + 1` })
      .where(eq(users.email, email))
      .returning({ id: users.id });
    if (!row) throw new Error(`No user found with email "${email}"`);
    console.log(
      `Password updated for user "${email}" (existing sessions revoked).`,
    );
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
