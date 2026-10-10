import { ServiceUnavailableException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Database } from '../database/drizzle.types';
import type { ProfileTransaction } from './profile-document';

/** Code Postgres `lock_not_available` : l'attente du verrou a dépassé `lock_timeout`. */
const LOCK_NOT_AVAILABLE = '55P03';

/**
 * Transaction sur la ligne du parcours dont l'attente de verrou est bornée à 5 s : une opération
 * portrait tient le verrou pendant son envoi S3 ; sans borne, chaque requête en attente garderait une
 * connexion du pool, partagé avec la lecture publique. Dépassement ⇒ 503, à réessayer.
 */
export async function inProfileTransaction<T>(
  db: Database,
  work: (tx: ProfileTransaction) => Promise<T>,
): Promise<T> {
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
      return work(tx);
    });
  } catch (err) {
    if (hasCode(err, LOCK_NOT_AVAILABLE)) {
      throw new ServiceUnavailableException(
        'Le parcours est en cours de modification : réessayez dans quelques secondes',
      );
    }
    throw err;
  }
}

/** Drizzle enveloppe l'erreur Postgres (`cause`) : on parcourt la chaîne. */
function hasCode(err: unknown, code: string): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 5; depth++) {
    if (current === null || typeof current !== 'object') return false;
    const { code: found, cause } = current as {
      code?: unknown;
      cause?: unknown;
    };
    if (found === code) return true;
    current = cause;
  }
  return false;
}
