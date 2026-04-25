import 'dotenv/config';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import argon2 from 'argon2';
import { sql } from 'drizzle-orm';
import { users } from '../schema/users';

async function main() {
  const url = process.env.DATABASE_URL;
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_INITIAL_PASSWORD;
  if (!url || !email || !password) {
    throw new Error('Missing DATABASE_URL, ADMIN_EMAIL, or ADMIN_INITIAL_PASSWORD in env');
  }
  const client = postgres(url, { max: 1 });
  const db = drizzle(client);
  try {
    const existing = await db.execute(sql`SELECT count(*)::int as c FROM users`);
    const count = (existing[0] as { c: number }).c;
    if (count > 0) {
      console.log(`Admin seed: ${count} user(s) already exist, skipping.`);
      return;
    }
    const passwordHash = await argon2.hash(password);
    await db.insert(users).values({ email, passwordHash });
    console.log(`Admin seed: created user "${email}".`);
  } finally {
    await client.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
