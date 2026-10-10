import 'reflect-metadata';
import {
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { and, eq, sql } from 'drizzle-orm';
import { DRIZZLE } from '../database/drizzle.constants';
import {
  profileContent,
  type ProfileContentRow,
} from '../database/schema/profile-content';
import { createMockDb } from '../database/test-utils';
import { StorageService } from '../storage/storage.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ProfileService } from './profile.service';
import type { ProfileContent } from './profile-content';
import { aProfileContent } from './profile-test-builders';

const UPDATED_AT = new Date('2026-10-11T08:00:00.000Z');

const aRow = (
  overrides: Partial<ProfileContentRow> = {},
): ProfileContentRow => ({
  id: 'main',
  content: aProfileContent(),
  version: 3,
  portraitKey: null,
  previousPortraitKey: null,
  updatedAt: UPDATED_AT,
  ...overrides,
});

describe('ProfileService', () => {
  let service: ProfileService;
  let db: ReturnType<typeof createMockDb>;

  beforeEach(async () => {
    db = createMockDb();
    const module = await Test.createTestingModule({
      providers: [
        ProfileService,
        { provide: DRIZZLE, useValue: db },
        {
          provide: StorageService,
          useValue: {
            getPublicUrl: jest.fn(
              (bucket: string, key: string) => `/storage/${bucket}/${key}`,
            ),
          },
        },
      ],
    }).compile();
    service = module.get(ProfileService);
  });

  describe('findCurrent', () => {
    it('Given the row, When read, Then the content comes flat with its version, date and a null portrait', async () => {
      db.limit.mockResolvedValueOnce([aRow()]);

      const result = await service.findCurrent();

      expect(db.where).toHaveBeenCalledWith(eq(profileContent.id, 'main'));
      expect(result).toEqual({
        ...aProfileContent(),
        version: 3,
        updatedAt: UPDATED_AT,
        portrait: null,
      });
    });

    it('Given no row, When read, Then NotFoundException', async () => {
      db.limit.mockResolvedValueOnce([]);

      await expect(service.findCurrent()).rejects.toThrow(NotFoundException);
    });

    it.each([
      [
        'profile/portrait-1a2b3c4d.avif',
        '/storage/portfolio-storage/profile/portrait-1a2b3c4d.avif',
      ],
      [null, null],
    ])(
      'Given portrait key %p, When read, Then portrait is %p (the previous key is never exposed)',
      async (portraitKey, portrait) => {
        db.limit.mockResolvedValueOnce([
          aRow({
            portraitKey,
            previousPortraitKey: 'profile/portrait-old.avif',
          }),
        ]);

        const result = await service.findCurrent();

        expect(result.portrait).toBe(portrait);
        expect(result).not.toHaveProperty('previousPortraitKey');
        expect(result).not.toHaveProperty('portraitKey');
      },
    );
  });

  describe('replace', () => {
    /** Le corps tel que la ValidationPipe le livre : une instance du DTO. */
    const aDto = (content: ProfileContent, version: number) =>
      plainToInstance(UpdateProfileDto, { ...content, version });

    const changed = aProfileContent({ workSummary: 'Résumé corrigé' });

    it('Given the same content, When replaced, Then nothing is written and the current document comes back', async () => {
      db.limit.mockResolvedValueOnce([aRow()]);

      const result = await service.replace(aDto(aProfileContent(), 3));

      expect(db.update).not.toHaveBeenCalled();
      expect(result).toEqual({
        ...aProfileContent(),
        version: 3,
        updatedAt: UPDATED_AT,
        portrait: null,
      });
    });

    it('Given the same content but a stale version, When replaced, Then the conditional write answers 409', async () => {
      db.limit.mockResolvedValueOnce([aRow({ version: 4 })]);
      db.returning.mockResolvedValueOnce([]);

      await expect(service.replace(aDto(aProfileContent(), 3))).rejects.toThrow(
        ConflictException,
      );
      expect(db.where).toHaveBeenLastCalledWith(
        and(eq(profileContent.id, 'main'), eq(profileContent.version, 3)),
      );
    });

    it('Given the same content stored with another key order (jsonb), When replaced, Then it is still identical', async () => {
      const { motivation, biography, ...rest } = aProfileContent();
      const reordered = {
        motivation: {
          description: motivation.description,
          statement: motivation.statement,
          title: motivation.title,
        },
        ...rest,
        biography,
      } as ProfileContent;
      db.limit.mockResolvedValueOnce([aRow({ content: reordered })]);

      await service.replace(aDto(aProfileContent(), 3));

      expect(db.update).not.toHaveBeenCalled();
    });

    it('Given a changed content and the current version, When replaced, Then a plain content is written under the version guard, and the version goes up', async () => {
      db.limit.mockResolvedValueOnce([aRow()]);
      db.returning.mockResolvedValueOnce([
        aRow({ content: changed, version: 4 }),
      ]);

      const result = await service.replace(aDto(changed, 3));

      expect(db.update).toHaveBeenCalledWith(profileContent);
      const [[patch]] = db.set.mock.calls as [[Record<string, unknown>]];
      // Colonnes du portrait hors versionnage : le PUT texte ne les écrit jamais.
      expect(Object.keys(patch).sort()).toEqual([
        'content',
        'updatedAt',
        'version',
      ]);
      expect(patch.content).toStrictEqual(changed);
      expect(patch.version).toEqual(sql`${profileContent.version} + 1`);
      expect(patch.updatedAt).toBeInstanceOf(Date);
      expect(db.where).toHaveBeenLastCalledWith(
        and(eq(profileContent.id, 'main'), eq(profileContent.version, 3)),
      );
      expect(result.version).toBe(4);
      expect(result.workSummary).toBe('Résumé corrigé');
    });

    it('Given a stale version, When replaced, Then ConflictException', async () => {
      db.limit.mockResolvedValueOnce([aRow({ version: 4 })]);
      db.returning.mockResolvedValueOnce([]);

      await expect(service.replace(aDto(changed, 3))).rejects.toThrow(
        ConflictException,
      );
    });

    it('Given the write fails, When replaced, Then the error propagates', async () => {
      db.limit.mockResolvedValueOnce([aRow()]);
      db.returning.mockRejectedValueOnce(new Error('db down'));

      await expect(service.replace(aDto(changed, 3))).rejects.toThrow(
        'db down',
      );
    });

    it('Given a changed content, When replaced, Then the write runs in a transaction that first bounds the lock wait (a portrait operation may hold the row)', async () => {
      const order: string[] = [];
      db.execute.mockImplementation(() => {
        order.push('set lock_timeout');
        return Promise.resolve();
      });
      db.update.mockImplementation(() => {
        order.push('update');
        return db;
      });
      db.limit.mockResolvedValueOnce([aRow()]);
      db.returning.mockResolvedValueOnce([
        aRow({ content: changed, version: 4 }),
      ]);

      await service.replace(aDto(changed, 3));

      expect(db.transaction).toHaveBeenCalledTimes(1);
      expect(order).toEqual(['set lock_timeout', 'update']);
    });

    it('Given the row stays locked beyond the timeout, When replaced, Then 503', async () => {
      db.limit.mockResolvedValueOnce([aRow()]);
      db.returning.mockRejectedValueOnce(
        Object.assign(new Error('lock timeout'), { code: '55P03' }),
      );

      await expect(service.replace(aDto(changed, 3))).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('Given no row, When replaced, Then NotFoundException', async () => {
      db.limit.mockResolvedValueOnce([]);

      await expect(service.replace(aDto(changed, 1))).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
