import { ServiceUnavailableException } from '@nestjs/common';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { Database } from '../database/drizzle.types';
import { createMockDb } from '../database/test-utils';
import { inProfileTransaction } from './profile-lock';

const asSql = (query: unknown) => new PgDialect().sqlToQuery(query as SQL).sql;
/** L'erreur Postgres « lock_not_available », telle que Drizzle l'enveloppe (`cause`). */
const aLockTimeout = () =>
  Object.assign(new Error('Failed query: select …'), {
    cause: Object.assign(new Error('canceling statement due to lock timeout'), {
      code: '55P03',
    }),
  });

describe('inProfileTransaction', () => {
  let db: ReturnType<typeof createMockDb>;
  let effects: string[];

  beforeEach(() => {
    effects = [];
    db = createMockDb();
    db.execute.mockImplementation((query: unknown) => {
      effects.push(asSql(query));
      return Promise.resolve();
    });
  });

  it('Given a unit of work, When run, Then it runs in a transaction whose first statement bounds the lock wait to 5 s', async () => {
    const result = await inProfileTransaction(db as unknown as Database, () => {
      effects.push('work');
      return Promise.resolve(42);
    });

    expect(result).toBe(42);
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(effects).toEqual(["SET LOCAL lock_timeout = '5s'", 'work']);
  });

  it.each([
    ['wrapped by Drizzle', aLockTimeout()],
    ['raw', Object.assign(new Error('lock timeout'), { code: '55P03' })],
  ])(
    'Given the lock wait times out (%s), When run, Then a clean 503 asks to retry',
    async (_label, err) => {
      await expect(
        inProfileTransaction(db as unknown as Database, () =>
          Promise.reject(err),
        ),
      ).rejects.toThrow(ServiceUnavailableException);
    },
  );

  it('Given another failure, When run, Then it propagates unchanged', async () => {
    const err = Object.assign(new Error('db down'), { code: '08006' });

    await expect(
      inProfileTransaction(db as unknown as Database, () =>
        Promise.reject(err),
      ),
    ).rejects.toBe(err);
  });
});
