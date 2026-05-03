/**
 * Change le password d'un user existant en CLI.
 *
 * Usage :
 *   pnpm db:change-password <email>
 *   → prompt interactif pour le password (caché, double saisie)
 *
 * Lit DATABASE_URL depuis .env, hash en Argon2id (mêmes paramètres que NestJS).
 */
import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import argon2 from 'argon2';
import postgres from 'postgres';
import { users } from '../src/database/schema/users';

const MIN_PASSWORD_LENGTH = 12;

// Codes ASCII des touches de contrôle (échappés en hex pour éviter les soucis d'édition)
const CTRL_C = '\x03';
const CTRL_D = '\x04';
const BACKSPACE = '\x7f';

async function readHiddenPassword(prompt: string): Promise<string> {
  process.stdout.write(prompt);
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    let pwd = '';
    const onData = (chunk: Buffer | string): void => {
      const ch = chunk.toString();
      if (ch === '\r' || ch === '\n' || ch === CTRL_D) {
        stdin.setRawMode?.(false);
        stdin.pause();
        stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(pwd);
      } else if (ch === CTRL_C) {
        stdin.setRawMode?.(false);
        stdin.pause();
        stdin.removeListener('data', onData);
        process.stdout.write('\n');
        reject(new Error('Interrompu (Ctrl+C)'));
      } else if (ch === BACKSPACE || ch === '\b') {
        if (pwd.length > 0) {
          pwd = pwd.slice(0, -1);
          process.stdout.write('\b \b');
        }
      } else {
        pwd += ch;
        process.stdout.write('*');
      }
    };
    stdin.on('data', onData);
  });
}

async function main(): Promise<void> {
  const email = process.argv[2];
  if (!email) {
    console.error('Usage: pnpm db:change-password <email>');
    process.exit(1);
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL absent du .env');
    process.exit(1);
  }

  const password = await readHiddenPassword(`Nouveau password pour ${email} : `);
  if (password.length < MIN_PASSWORD_LENGTH) {
    console.error(`Password trop court (min ${MIN_PASSWORD_LENGTH} caractères)`);
    process.exit(1);
  }

  const confirm = await readHiddenPassword('Confirme : ');
  if (password !== confirm) {
    console.error('Les deux passwords ne matchent pas');
    process.exit(1);
  }

  const client = postgres(url, { max: 1 });
  const db = drizzle(client);

  try {
    const hash = await argon2.hash(password);
    const updated = await db
      .update(users)
      .set({ passwordHash: hash, updatedAt: new Date() })
      .where(eq(users.email, email))
      .returning({ id: users.id, email: users.email });

    if (updated.length === 0) {
      console.error(`Aucun user avec l'email "${email}"`);
      process.exit(1);
    }

    console.log(`✅ Password mis à jour pour ${updated[0].email}`);
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  console.error('❌ Erreur :', err instanceof Error ? err.message : err);
  process.exit(1);
});
