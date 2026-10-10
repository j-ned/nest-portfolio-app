import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import type { Database } from '../database/drizzle.types';
import { schema } from '../database/schema';
import {
  PROFILE_ROW_ID,
  profileContent,
} from '../database/schema/profile-content';
import type { ImageOptimizer } from '../storage/image-optimizer.service';
import { contentHash } from '../storage/s3-utils';
import type { StorageService } from '../storage/storage.service';
import type { UpdateProfileDto } from './dto/update-profile.dto';
import { ProfilePortraitService } from './profile-portrait.service';
import { ProfileService } from './profile.service';

/**
 * Sérialisation des opérations portrait sur un vrai Postgres (verrou `FOR UPDATE`). Ignoré sans
 * base dédiée : `PROFILE_IT_DATABASE_URL=postgres://…@127.0.0.1:…/… pnpm test -- profile-portrait.integration`
 * sur un conteneur jetable (les migrations y sont appliquées, la base est écrasée).
 */
const DATABASE_URL = process.env.PROFILE_IT_DATABASE_URL;
const ROUNDS = 5;

const randomDelay = () => Math.floor(Math.random() * 15);
/** Délais du faux stockage (ms) : aléatoires par défaut, figés par un test déterministe. */
type Delays = {
  image: () => number;
  upload: () => number;
  delete: () => number;
};

(DATABASE_URL ? describe : describe.skip)(
  'ProfilePortraitService on Postgres (spec 021, A5)',
  () => {
    let client: ReturnType<typeof postgres>;
    let db: Database;
    let service: ProfilePortraitService;
    let profile: ProfileService;
    let delays: Delays;
    /** Appelé au début de chaque suppression S3, avant qu'elle n'aboutisse. */
    let onDelete: (key: string) => void;
    /** Le faux bucket, et les suppressions qui ont retiré un objet que la ligne validée cite. */
    let bucket: Set<string>;
    let violations: string[];

    const committedKeys = async () => {
      const [row] = await db
        .select()
        .from(profileContent)
        .where(eq(profileContent.id, PROFILE_ROW_ID));
      return [row.portraitKey, row.previousPortraitKey].filter(
        (key): key is string => key !== null,
      );
    };

    beforeAll(async () => {
      client = postgres(DATABASE_URL ?? '', { max: 30, onnotice: () => {} });
      db = drizzle(client, { schema, casing: 'snake_case' });
      await migrate(db, {
        migrationsFolder: resolve(__dirname, '../../drizzle'),
      });
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    });
    afterAll(async () => {
      jest.restoreAllMocks();
      await client.end();
    });

    beforeEach(async () => {
      bucket = new Set();
      violations = [];
      delays = { image: randomDelay, upload: randomDelay, delete: randomDelay };
      onDelete = () => {};
      await db
        .update(profileContent)
        .set({ portraitKey: null, previousPortraitKey: null })
        .where(eq(profileContent.id, PROFILE_ROW_ID));
      const storage = {
        upload: async (_bucket: string, key: string) => {
          await sleep(delays.upload());
          bucket.add(key);
        },
        delete: async (_bucket: string, key: string) => {
          // Lecture hors transaction : l'état validé, celui que le front lit au même instant.
          if ((await committedKeys()).includes(key)) violations.push(key);
          onDelete(key);
          await sleep(delays.delete());
          bucket.delete(key);
        },
        getPublicUrl: (bucketName: string, key: string) =>
          `/storage/${bucketName}/${key}`,
      } as unknown as StorageService;
      const images = {
        toPortrait: async (buffer: Buffer) => {
          await sleep(delays.image());
          return { buffer, mimetype: 'image/avif', ext: 'avif' };
        },
      } as unknown as ImageOptimizer;
      service = new ProfilePortraitService(db, storage, images);
      profile = new ProfileService(db, storage);
    });

    /** Aucune clé citée absente du bucket, aucun objet orphelin, aucune suppression d'objet cité. */
    const expectConsistent = async () => {
      expect(violations).toEqual([]);
      expect([...bucket].sort()).toEqual((await committedKeys()).sort());
    };
    const aFile = (bytes: string) =>
      ({ buffer: Buffer.from(bytes) }) as Express.Multer.File;
    /** Clé du faux recadrage (identité) : celle que le service calcule. */
    const keyOf = (file: Express.Multer.File) =>
      `profile/portrait-${contentHash(file.buffer)}.avif`;
    /** État initial : la ligne cite ces clés, le bucket les contient. */
    const givenKeys = async (
      portraitKey: string,
      previousPortraitKey: string,
    ) => {
      await db
        .update(profileContent)
        .set({ portraitKey, previousPortraitKey })
        .where(eq(profileContent.id, PROFILE_ROW_ID));
      bucket = new Set([portraitKey, previousPortraitKey]);
    };
    /** Une autre connexion tient le verrou de la ligne jusqu'à `release()`. */
    const holdRowLock = async () => {
      let release = () => {};
      const released = new Promise<void>((resolve) => (release = resolve));
      let locked = () => {};
      const isLocked = new Promise<void>((resolve) => (locked = resolve));
      const done = client.begin(async (tx) => {
        await tx`SELECT id FROM profile_content WHERE id = 'main' FOR UPDATE`;
        locked();
        await released;
      });
      await isLocked;
      return async () => {
        release();
        await done;
      };
    };

    it('Given an older key being deleted, When the same file is sent again during that deletion, Then it waits for the lock and re-uploads after it: the cited key exists', async () => {
      const older = aFile('older');
      const next = aFile('next');
      await givenKeys('profile/portrait-current.avif', keyOf(older));
      // Ordre figé : envoi rapide, suppression lente ; le renvoi part au début de la suppression.
      delays = { image: () => 0, upload: () => 5, delete: () => 50 };
      let resent: Promise<unknown> = Promise.resolve();
      onDelete = (key) => {
        if (key === keyOf(older)) {
          onDelete = () => {};
          resent = service.replace(older);
        }
      };

      await service.replace(next);
      await resent;

      expect(await committedKeys()).toEqual([keyOf(older), keyOf(next)]);
      await expectConsistent();
    });

    it('Given another connection holds the row beyond the lock timeout, When a portrait is sent, Then 503 after about 5 s, nothing is stored, and the public read is not blocked', async () => {
      const release = await holdRowLock();
      try {
        const startedAt = Date.now();
        const sending = service.replace(aFile('blocked'));
        const read = await profile.findCurrent();
        const readMs = Date.now() - startedAt;

        await expect(sending).rejects.toThrow(ServiceUnavailableException);
        const waitedMs = Date.now() - startedAt;

        expect(read.portrait).toBeNull();
        expect(readMs).toBeLessThan(1_000);
        expect(waitedMs).toBeGreaterThanOrEqual(4_900);
        expect(waitedMs).toBeLessThan(8_000);
        expect(bucket.size).toBe(0);
      } finally {
        await release();
      }
    }, 15_000);

    it('Given another connection holds the row beyond the lock timeout, When the text is saved, Then 503 instead of waiting without bound', async () => {
      const current = await profile.findCurrent();
      const { version } = current;
      // `toProfileContent` recopie champ par champ : `updatedAt` et `portrait` sont ignorés.
      const dto = {
        ...current,
        workSummary: `${current.workSummary} (modifié)`,
      } as unknown as UpdateProfileDto;
      const release = await holdRowLock();
      try {
        await expect(profile.replace(dto)).rejects.toThrow(
          ServiceUnavailableException,
        );
      } finally {
        await release();
      }
      expect((await profile.findCurrent()).version).toBe(version);
    }, 15_000);

    it('Given the same file sent many times at once, When all run, Then all succeed and the bucket matches the row', async () => {
      for (let round = 0; round < ROUNDS; round++) {
        const file = aFile(`same-${round}`);
        const results = await Promise.allSettled(
          Array.from({ length: 8 }, () => service.replace(file)),
        );

        expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
        await expectConsistent();
      }
    });

    it('Given different files, repeated files and removals at once, When all run, Then the bucket matches the row', async () => {
      for (let round = 0; round < ROUNDS; round++) {
        const files = ['a', 'b', 'c'].map((name) => aFile(`${name}-${round}`));
        const results = await Promise.allSettled([
          ...files.flatMap((file) => [
            service.replace(file),
            service.replace(file),
          ]),
          service.remove(),
          service.replace(files[0]),
          service.remove(),
        ]);

        expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
        await expectConsistent();
      }
    });
  },
);
