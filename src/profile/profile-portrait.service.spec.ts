import { createHash } from 'node:crypto';
import {
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DRIZZLE } from '../database/drizzle.constants';
import type { ProfileContentRow } from '../database/schema/profile-content';
import { createMockDb } from '../database/test-utils';
import { ImageOptimizer } from '../storage/image-optimizer.service';
import { StorageService } from '../storage/storage.service';
import { ProfilePortraitService } from './profile-portrait.service';
import { aProfileContent } from './profile-test-builders';

const BUCKET = 'portfolio-storage';
/** Le faux recadrage préfixe les octets reçus : deux fichiers différents ⇒ deux clés différentes. */
const toAvif = (buffer: Buffer) =>
  Buffer.concat([Buffer.from('avif:'), buffer]);
const keyOf = (file: Express.Multer.File) =>
  `profile/portrait-${createHash('sha256').update(toAvif(file.buffer)).digest('hex').slice(0, 8)}.avif`;
const aFile = (bytes: string) =>
  ({
    buffer: Buffer.from(bytes),
    mimetype: 'image/jpeg',
  }) as Express.Multer.File;

const file = aFile('jpeg-bytes');
const NEW_KEY = keyOf(file);
const CURRENT = 'profile/portrait-cccccccc.avif';
const PREVIOUS = 'profile/portrait-pppppppp.avif';

const aRow = (
  overrides: Partial<ProfileContentRow> = {},
): ProfileContentRow => ({
  id: 'main',
  content: aProfileContent(),
  version: 2,
  portraitKey: null,
  previousPortraitKey: null,
  updatedAt: new Date('2026-10-11T08:00:00.000Z'),
  ...overrides,
});

describe('ProfilePortraitService (spec 021, A5)', () => {
  let service: ProfilePortraitService;
  let db: ReturnType<typeof createMockDb>;
  let storage: {
    upload: jest.Mock;
    delete: jest.Mock;
    getPublicUrl: jest.Mock;
  };
  let images: { toPortrait: jest.Mock };
  /** Journal ordonné : transactions, verrou, envoi, écriture, suppression. */
  let effects: string[];
  /** La ligne unique de la fausse table, lue et écrite par le faux builder. */
  let stored: ProfileContentRow | undefined;
  /** Les clés présentes dans le faux bucket. */
  let bucket: Set<string>;

  beforeEach(async () => {
    effects = [];
    stored = undefined;
    bucket = new Set();
    db = createMockDb();
    // Chaque transaction prend le verrou de la ligne en premier : le faux les exécute donc l'une
    // après l'autre, comme Postgres le fait sous `FOR UPDATE`.
    let queue: Promise<unknown> = Promise.resolve();
    db.transaction.mockImplementation((fn: (tx: unknown) => unknown) => {
      const run = queue.then(async () => {
        effects.push('begin');
        try {
          const result = await fn(db);
          effects.push('commit');
          return result;
        } catch (err) {
          effects.push('rollback');
          throw err;
        }
      });
      queue = run.catch(() => undefined);
      return run;
    });
    db.execute.mockImplementation(() => {
      effects.push('set lock_timeout');
      return Promise.resolve();
    });
    db.for.mockImplementation(() => {
      effects.push('lock');
      return db;
    });
    db.limit.mockImplementation(() => Promise.resolve(stored ? [stored] : []));
    db.returning.mockImplementation(() => {
      const patch = (db.set.mock.calls as [Partial<ProfileContentRow>][]).at(
        -1,
      )?.[0];
      stored = { ...(stored as ProfileContentRow), ...patch };
      effects.push('write');
      return Promise.resolve([stored]);
    });
    storage = {
      upload: jest.fn((_b: string, key: string) => {
        effects.push(`upload ${key}`);
        bucket.add(key);
        return Promise.resolve();
      }),
      delete: jest.fn((_b: string, key: string) => {
        effects.push(`delete ${key}`);
        bucket.delete(key);
        return Promise.resolve();
      }),
      getPublicUrl: jest.fn(
        (bucketName: string, key: string) => `/storage/${bucketName}/${key}`,
      ),
    };
    images = {
      toPortrait: jest.fn((buffer: Buffer) =>
        Promise.resolve({
          buffer: toAvif(buffer),
          mimetype: 'image/avif',
          ext: 'avif',
          width: 640,
          height: 800,
        }),
      ),
    };
    const module = await Test.createTestingModule({
      providers: [
        ProfilePortraitService,
        { provide: DRIZZLE, useValue: db },
        { provide: StorageService, useValue: storage },
        { provide: ImageOptimizer, useValue: images },
      ],
    }).compile();
    service = module.get(ProfilePortraitService);
  });
  afterEach(() => jest.restoreAllMocks());

  /** La ligne en base, et les objets qu'elle cite présents dans le bucket. */
  const given = (row: ProfileContentRow) => {
    stored = row;
    for (const key of [row.portraitKey, row.previousPortraitKey]) {
      if (key) bucket.add(key);
    }
  };
  /** Le `SET` de la première écriture (absent ⇒ `undefined`, l'assertion échoue sur la valeur). */
  const patch = () =>
    (db.set.mock.calls as [Partial<ProfileContentRow>][])[0]?.[0];
  /** Aucune clé citée par la ligne n'est absente du bucket, et aucun objet n'y est orphelin. */
  const expectConsistent = () => {
    const cited = [stored?.portraitKey, stored?.previousPortraitKey].filter(
      (key): key is string => Boolean(key),
    );
    expect([...bucket].sort()).toEqual([...new Set(cited)].sort());
  };

  describe('replace', () => {
    it('Given no portrait yet, When a file is sent, Then under the row lock it is stored under its hashed key and written, in one transaction', async () => {
      given(aRow());

      const result = await service.replace(file);

      expect(images.toPortrait).toHaveBeenCalledWith(file.buffer);
      expect(storage.upload).toHaveBeenCalledWith(
        BUCKET,
        NEW_KEY,
        toAvif(file.buffer),
        'image/avif',
      );
      expect(patch()).toEqual({
        portraitKey: NEW_KEY,
        previousPortraitKey: null,
        updatedAt: expect.any(Date) as Date,
      });
      expect(effects).toEqual([
        'begin',
        'set lock_timeout',
        'lock',
        `upload ${NEW_KEY}`,
        'write',
        'commit',
      ]);
      expect(result.portrait).toBe(`/storage/${BUCKET}/${NEW_KEY}`);
      expect(result.version).toBe(2);
    });

    it('Given the lock, When taken, Then it is a FOR UPDATE on the row', async () => {
      given(aRow());

      await service.replace(file);

      expect(db.for).toHaveBeenCalledWith('update');
    });

    it('Given a current portrait and no previous one, When replaced, Then the current key becomes the previous one and nothing is deleted (a page already served still cites it)', async () => {
      given(aRow({ portraitKey: CURRENT }));

      await service.replace(file);

      expect(patch()).toMatchObject({
        portraitKey: NEW_KEY,
        previousPortraitKey: CURRENT,
      });
      expect(storage.delete).not.toHaveBeenCalled();
      expectConsistent();
    });

    it('Given a current and a previous portrait, When replaced, Then the previous one is deleted after the commit, under the lock again', async () => {
      given(aRow({ portraitKey: CURRENT, previousPortraitKey: PREVIOUS }));

      await service.replace(file);

      expect(effects).toEqual([
        'begin',
        'set lock_timeout',
        'lock',
        `upload ${NEW_KEY}`,
        'write',
        'commit',
        'begin',
        'set lock_timeout',
        'lock',
        `delete ${PREVIOUS}`,
        'commit',
      ]);
      expectConsistent();
    });

    it('Given the same file as the current portrait, When sent again, Then nothing is uploaded, written nor deleted', async () => {
      given(aRow({ portraitKey: NEW_KEY, previousPortraitKey: PREVIOUS }));

      const result = await service.replace(file);

      expect(effects).toEqual(['begin', 'set lock_timeout', 'lock', 'commit']);
      expect(db.update).not.toHaveBeenCalled();
      expect(result.portrait).toBe(`/storage/${BUCKET}/${NEW_KEY}`);
    });

    it('Given the file of the previous portrait, When sent again, Then it becomes current and nothing is deleted', async () => {
      given(aRow({ portraitKey: CURRENT, previousPortraitKey: NEW_KEY }));

      await service.replace(file);

      expect(patch()).toMatchObject({
        portraitKey: NEW_KEY,
        previousPortraitKey: CURRENT,
      });
      expect(storage.delete).not.toHaveBeenCalled();
      expectConsistent();
    });

    it('Given the write fails, When replaced, Then the transaction rolls back, the unreferenced new object is deleted under the lock and the error propagates', async () => {
      given(aRow({ portraitKey: CURRENT, previousPortraitKey: PREVIOUS }));
      db.returning.mockRejectedValueOnce(new Error('db down'));

      await expect(service.replace(file)).rejects.toThrow('db down');

      expect(effects).toEqual([
        'begin',
        'set lock_timeout',
        'lock',
        `upload ${NEW_KEY}`,
        'rollback',
        'begin',
        'set lock_timeout',
        'lock',
        `delete ${NEW_KEY}`,
        'commit',
      ]);
      expectConsistent();
    });

    it('Given the write fails while the new key is the previous portrait, When replaced, Then that still referenced object is kept', async () => {
      given(aRow({ portraitKey: CURRENT, previousPortraitKey: NEW_KEY }));
      db.returning.mockRejectedValueOnce(new Error('db down'));

      await expect(service.replace(file)).rejects.toThrow('db down');

      expect(storage.delete).not.toHaveBeenCalled();
      expectConsistent();
    });

    it('Given the upload fails, When replaced, Then nothing is written and the error propagates', async () => {
      given(aRow({ portraitKey: CURRENT }));
      storage.upload.mockRejectedValueOnce(new Error('s3 down'));

      await expect(service.replace(file)).rejects.toThrow('s3 down');

      expect(db.update).not.toHaveBeenCalled();
      expect(effects.slice(0, 4)).toEqual([
        'begin',
        'set lock_timeout',
        'lock',
        'rollback',
      ]);
      expect(stored).toMatchObject({ portraitKey: CURRENT });
    });

    it('Given the deletion of the previous portrait fails, When replaced, Then the new document comes back, the write stays committed and the key is logged', async () => {
      given(aRow({ portraitKey: CURRENT, previousPortraitKey: PREVIOUS }));
      storage.delete.mockRejectedValueOnce(new Error('s3 down'));
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      const result = await service.replace(file);

      expect(result.portrait).toBe(`/storage/${BUCKET}/${NEW_KEY}`);
      expect(stored).toMatchObject({
        portraitKey: NEW_KEY,
        previousPortraitKey: CURRENT,
      });
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining(PREVIOUS),
        expect.anything(),
      );
    });

    it('Given an unreadable image, When sent, Then 422 before any lock, upload or write', async () => {
      given(aRow());
      images.toPortrait.mockRejectedValueOnce(
        new UnprocessableEntityException('Image illisible'),
      );

      await expect(service.replace(file)).rejects.toThrow(
        UnprocessableEntityException,
      );
      expect(db.transaction).not.toHaveBeenCalled();
      expect(storage.upload).not.toHaveBeenCalled();
    });

    it('Given another portrait operation holds the lock beyond the timeout, When a file is sent, Then 503 and nothing is stored', async () => {
      given(aRow({ portraitKey: CURRENT }));
      db.limit.mockRejectedValueOnce(
        Object.assign(new Error('lock timeout'), { code: '55P03' }),
      );

      await expect(service.replace(file)).rejects.toThrow(
        ServiceUnavailableException,
      );
      expect(storage.upload).not.toHaveBeenCalled();
      expect(db.update).not.toHaveBeenCalled();
    });

    it('Given no row, When a file is sent, Then 404 and nothing is stored', async () => {
      await expect(service.replace(file)).rejects.toThrow(NotFoundException);
      expect(storage.upload).not.toHaveBeenCalled();
      expect(storage.delete).not.toHaveBeenCalled();
    });

    it('Given the same file sent twice at once, When both run, Then the second waits for the lock, sees the winner and changes nothing: no cited key is ever deleted', async () => {
      given(aRow({ portraitKey: CURRENT, previousPortraitKey: PREVIOUS }));

      const results = await Promise.allSettled([
        service.replace(file),
        service.replace(file),
      ]);

      expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
      expect(storage.upload).toHaveBeenCalledTimes(1);
      expect(storage.delete.mock.calls).toEqual([[BUCKET, PREVIOUS]]);
      expect(stored).toMatchObject({
        portraitKey: NEW_KEY,
        previousPortraitKey: CURRENT,
      });
      expectConsistent();
    });

    it('Given two different files sent at once, When both run, Then they apply one after the other and the bucket holds exactly the cited keys', async () => {
      given(aRow({ portraitKey: CURRENT, previousPortraitKey: PREVIOUS }));
      const other = aFile('other-jpeg-bytes');

      await Promise.all([service.replace(file), service.replace(other)]);

      expect(stored).toMatchObject({
        portraitKey: keyOf(other),
        previousPortraitKey: NEW_KEY,
      });
      expectConsistent();
    });

    it('Given a removal racing a replacement, When both run, Then the row and the bucket stay consistent', async () => {
      given(aRow({ portraitKey: CURRENT, previousPortraitKey: PREVIOUS }));

      await Promise.all([service.replace(file), service.remove()]);

      // L'un ou l'autre ordre sériel, jamais un entrelacement.
      expect([
        { portraitKey: null, previousPortraitKey: NEW_KEY },
        { portraitKey: NEW_KEY, previousPortraitKey: null },
      ]).toContainEqual({
        portraitKey: stored?.portraitKey,
        previousPortraitKey: stored?.previousPortraitKey,
      });
      expectConsistent();
    });
  });

  describe('remove', () => {
    it('Given a current and a previous portrait, When removed, Then under the lock the key is cleared and kept as previous, then the older one is deleted', async () => {
      given(aRow({ portraitKey: CURRENT, previousPortraitKey: PREVIOUS }));

      await service.remove();

      expect(patch()).toEqual({
        portraitKey: null,
        previousPortraitKey: CURRENT,
        updatedAt: expect.any(Date) as Date,
      });
      expect(effects).toEqual([
        'begin',
        'set lock_timeout',
        'lock',
        'write',
        'commit',
        'begin',
        'set lock_timeout',
        'lock',
        `delete ${PREVIOUS}`,
        'commit',
      ]);
      expectConsistent();
    });

    it('Given a current portrait only, When removed, Then nothing is deleted (a page already served still cites it)', async () => {
      given(aRow({ portraitKey: CURRENT }));

      await service.remove();

      expect(patch()).toMatchObject({
        portraitKey: null,
        previousPortraitKey: CURRENT,
      });
      expect(effects).toEqual([
        'begin',
        'set lock_timeout',
        'lock',
        'write',
        'commit',
      ]);
    });

    it('Given no current portrait, When removed, Then nothing is written nor deleted', async () => {
      given(aRow({ previousPortraitKey: PREVIOUS }));

      await service.remove();

      expect(effects).toEqual(['begin', 'set lock_timeout', 'lock', 'commit']);
      expect(db.update).not.toHaveBeenCalled();
    });

    it('Given the write fails, When removed, Then it rolls back and nothing is deleted', async () => {
      given(aRow({ portraitKey: CURRENT, previousPortraitKey: PREVIOUS }));
      db.returning.mockRejectedValueOnce(new Error('db down'));

      await expect(service.remove()).rejects.toThrow('db down');
      expect(effects).toEqual([
        'begin',
        'set lock_timeout',
        'lock',
        'rollback',
      ]);
      expect(storage.delete).not.toHaveBeenCalled();
    });

    it('Given the deletion of the older portrait fails, When removed, Then it resolves and logs the key', async () => {
      given(aRow({ portraitKey: CURRENT, previousPortraitKey: PREVIOUS }));
      storage.delete.mockRejectedValueOnce(new Error('s3 down'));
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      await expect(service.remove()).resolves.toBeUndefined();

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining(PREVIOUS),
        expect.anything(),
      );
    });

    it('Given another portrait operation holds the lock beyond the timeout, When removed, Then 503 and nothing is written', async () => {
      given(aRow({ portraitKey: CURRENT }));
      db.limit.mockRejectedValueOnce(
        Object.assign(new Error('lock timeout'), { code: '55P03' }),
      );

      await expect(service.remove()).rejects.toThrow(
        ServiceUnavailableException,
      );
      expect(db.update).not.toHaveBeenCalled();
    });

    it('Given no row, When removed, Then 404', async () => {
      await expect(service.remove()).rejects.toThrow(NotFoundException);
    });
  });
});
