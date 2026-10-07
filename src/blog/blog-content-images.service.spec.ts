import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { DRIZZLE } from '../database/drizzle.constants';
import { createMockDb } from '../database/test-utils';
import { ImageOptimizer } from '../storage/image-optimizer.service';
import { contentHash } from '../storage/s3-utils';
import { StorageService } from '../storage/storage.service';
import { BlogContentImagesService } from './blog-content-images.service';

const BUCKET = 'portfolio-storage';
const POST_ID = '11111111-1111-4111-8111-111111111111';
const KEY_A =
  'blog-content/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa-a1b2c3d4-1600x900.avif';
const KEY_B =
  'blog-content/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb-deadbeef-800x600.avif';
const cite = (key: string) =>
  `![alt](https://api.nedellec-julien.fr/api/storage/${BUCKET}/${key})`;

describe('BlogContentImagesService', () => {
  let service: BlogContentImagesService;
  let db: ReturnType<typeof createMockDb>;
  let storage: {
    upload: jest.Mock;
    delete: jest.Mock;
    getPublicUrl: jest.Mock;
  };
  const avif = Buffer.from('avif-bytes');
  const optimize = jest.fn();

  beforeEach(async () => {
    jest.clearAllMocks();
    db = createMockDb();
    storage = {
      upload: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
      getPublicUrl: jest.fn(
        (bucket: string, key: string) => `/storage/${bucket}/${key}`,
      ),
    };
    optimize.mockResolvedValue({
      buffer: avif,
      mimetype: 'image/avif',
      ext: 'avif',
      width: 1600,
      height: 900,
    });
    const module = await Test.createTestingModule({
      providers: [
        BlogContentImagesService,
        { provide: DRIZZLE, useValue: db },
        { provide: StorageService, useValue: storage },
        { provide: ImageOptimizer, useValue: { optimize } },
      ],
    }).compile();
    service = module.get(BlogContentImagesService);
  });

  describe('upload', () => {
    const file = { buffer: Buffer.from('png-bytes') } as Express.Multer.File;

    it('Given an image, When uploaded, Then the AVIF is stored under a blog-content key carrying its dimensions', async () => {
      await service.upload(file);

      expect(optimize).toHaveBeenCalledWith(file.buffer);
      expect(storage.upload).toHaveBeenCalledTimes(1);
      const [bucket, key, body, mimetype] = storage.upload.mock.calls[0] as [
        string,
        string,
        Buffer,
        string,
      ];
      expect(bucket).toBe(BUCKET);
      expect(key).toMatch(
        /^blog-content\/[0-9a-f-]{36}-[0-9a-f]{8}-1600x900\.avif$/,
      );
      expect(key).toContain(`-${contentHash(avif)}-`);
      expect(body).toBe(avif);
      expect(mimetype).toBe('image/avif');
    });

    it('Given an image, When uploaded, Then the public URL and the intrinsic dimensions are returned', async () => {
      const result = await service.upload(file);

      const key = (storage.upload.mock.calls[0] as string[])[1];
      expect(storage.getPublicUrl).toHaveBeenCalledWith(BUCKET, key);
      expect(result).toEqual({
        url: `/storage/${BUCKET}/${key}`,
        width: 1600,
        height: 900,
      });
    });

    it('Given two uploads of the same image, When uploaded, Then each gets its own key', async () => {
      await service.upload(file);
      await service.upload(file);
      const keys = storage.upload.mock.calls.map((c: unknown[]) => c[1]);
      expect(keys[0]).not.toBe(keys[1]);
    });

    it('Given an image, When uploaded, Then nothing is written to the database', async () => {
      await service.upload(file);
      expect(db.insert).not.toHaveBeenCalled();
      expect(db.update).not.toHaveBeenCalled();
      expect(db.select).not.toHaveBeenCalled();
    });

    it('Given an unreadable image, When uploaded, Then the optimizer error propagates and nothing is stored', async () => {
      optimize.mockRejectedValueOnce(new Error('unreadable'));
      await expect(service.upload(file)).rejects.toThrow('unreadable');
      expect(storage.upload).not.toHaveBeenCalled();
    });
  });

  describe('removeUnreferenced', () => {
    it('Given no key, When called, Then neither the database nor the storage is touched', async () => {
      await service.removeUnreferenced([], POST_ID);
      expect(db.select).not.toHaveBeenCalled();
      expect(storage.delete).not.toHaveBeenCalled();
    });

    it('Given keys, When called, Then other posts are searched excluding the deleted one, with parameterised LIKE', async () => {
      db.where.mockResolvedValueOnce([]);
      await service.removeUnreferenced([KEY_A, KEY_B], POST_ID);

      const [condition] = db.where.mock.calls[0] as [SQL];
      const query = new PgDialect().sqlToQuery(condition);
      expect(query.sql).toBe(
        '("blog_post"."id" <> $1 and ("blog_post"."content_markdown" LIKE $2 or "blog_post"."content_markdown" LIKE $3))',
      );
      expect(query.params).toEqual([POST_ID, `%${KEY_A}%`, `%${KEY_B}%`]);
    });

    it('Given forged keys only, When called, Then neither the database nor the storage is touched', async () => {
      await service.removeUnreferenced(
        [
          'blog-content/../cv/cv.pdf',
          'blog/cover.avif',
          '%',
          `${KEY_A}.share.jpg`,
        ],
        POST_ID,
      );
      expect(db.select).not.toHaveBeenCalled();
      expect(storage.delete).not.toHaveBeenCalled();
    });

    it('Given a forged key among valid ones, When called, Then it is neither queried nor deleted', async () => {
      const forged = 'blog-content/../cv/cv.pdf';
      db.where.mockResolvedValueOnce([]);
      await service.removeUnreferenced([forged, KEY_A], POST_ID);

      const [condition] = db.where.mock.calls[0] as [SQL];
      expect(new PgDialect().sqlToQuery(condition).params).toEqual([
        POST_ID,
        `%${KEY_A}%`,
      ]);
      expect(storage.delete).toHaveBeenCalledTimes(1);
      expect(storage.delete).toHaveBeenCalledWith(BUCKET, KEY_A);
    });

    it('Given keys no other post cites, When called, Then every object is deleted', async () => {
      db.where.mockResolvedValueOnce([]);
      await service.removeUnreferenced([KEY_A, KEY_B], POST_ID);
      expect(storage.delete).toHaveBeenCalledWith(BUCKET, KEY_A);
      expect(storage.delete).toHaveBeenCalledWith(BUCKET, KEY_B);
      expect(storage.delete).toHaveBeenCalledTimes(2);
    });

    it('Given a key another post also cites, When called, Then that object is kept and the others are deleted', async () => {
      db.where.mockResolvedValueOnce([
        { contentMarkdown: `Intro\n\n${cite(KEY_A)}` },
      ]);
      await service.removeUnreferenced([KEY_A, KEY_B], POST_ID);
      expect(storage.delete).toHaveBeenCalledTimes(1);
      expect(storage.delete).toHaveBeenCalledWith(BUCKET, KEY_B);
    });

    it('Given every key is cited elsewhere, When called, Then nothing is deleted', async () => {
      db.where.mockResolvedValueOnce([
        { contentMarkdown: cite(KEY_A) },
        { contentMarkdown: cite(KEY_B) },
      ]);
      await service.removeUnreferenced([KEY_A, KEY_B], POST_ID);
      expect(storage.delete).not.toHaveBeenCalled();
    });

    it('Given a storage failure on one key, When called, Then the others are still deleted, the error is logged and nothing throws', async () => {
      const logError = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      db.where.mockResolvedValueOnce([]);
      storage.delete.mockRejectedValueOnce(new Error('S3 down'));

      await expect(
        service.removeUnreferenced([KEY_A, KEY_B], POST_ID),
      ).resolves.toBeUndefined();

      expect(storage.delete).toHaveBeenCalledWith(BUCKET, KEY_B);
      expect(logError).toHaveBeenCalledWith(
        expect.stringContaining(KEY_A),
        expect.anything(),
      );
      logError.mockRestore();
    });
  });
});
