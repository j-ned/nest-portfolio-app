/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { CvService } from './cv.service';
import { DRIZZLE } from '../database/drizzle.constants';
import { createMockDb } from '../database/test-utils';
import { StorageService } from '../storage/storage.service';
import type { CvFile } from '../database/schema';

describe('CvService', () => {
  let service: CvService;
  let db: ReturnType<typeof createMockDb>;
  let storage: jest.Mocked<StorageService>;

  const mkCvFile = (overrides: Partial<CvFile> = {}): CvFile => ({
    id: '11111111-1111-1111-1111-111111111111',
    fileName: 'Julien-CV.pdf',
    fileKey: 'cv/cv.pdf',
    fileSize: 524288,
    mimeType: 'application/pdf',
    uploadedAt: new Date('2026-04-26T00:00:00Z'),
    updatedAt: new Date('2026-04-26T00:00:00Z'),
    ...overrides,
  });

  const mkFile = (
    overrides: Partial<Express.Multer.File> = {},
  ): Express.Multer.File =>
    ({
      buffer: Buffer.from('fake-pdf-content'),
      mimetype: 'application/pdf',
      originalname: 'Julien-CV.pdf',
      size: 524288,
      ...overrides,
    }) as Express.Multer.File;

  beforeEach(async () => {
    db = createMockDb();
    storage = {
      upload: jest.fn().mockResolvedValue(undefined),
      get: jest.fn().mockResolvedValue(Buffer.from('pdf-bytes')),
      delete: jest.fn().mockResolvedValue(undefined),
      list: jest.fn(),
      getPublicUrl: jest.fn(),
    } as unknown as jest.Mocked<StorageService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CvService,
        { provide: DRIZZLE, useValue: db },
        { provide: StorageService, useValue: storage },
      ],
    }).compile();
    service = module.get(CvService);
  });

  describe('upsert', () => {
    it('INSERT si pas de CV existant : upload S3 + insert row', async () => {
      const file = mkFile();
      // SELECT.from.limit (no rows)
      db.limit.mockResolvedValueOnce([]);
      // INSERT.values.returning
      const created = mkCvFile();
      db.returning.mockResolvedValueOnce([created]);

      const result = await service.upsert(file);

      expect(storage.upload).toHaveBeenCalledWith(
        'portfolio-storage',
        'cv/cv.pdf',
        file.buffer,
        'application/pdf',
      );
      expect(result).toEqual(created);
    });

    it('UPDATE si CV existant : upload S3 + update row', async () => {
      const file = mkFile({ originalname: 'Julien-CV-2026.pdf' });
      const existing = mkCvFile();
      db.limit.mockResolvedValueOnce([existing]);
      const updated = mkCvFile({
        fileName: 'Julien-CV-2026.pdf',
        updatedAt: new Date('2026-05-01T00:00:00Z'),
      });
      db.returning.mockResolvedValueOnce([updated]);

      const result = await service.upsert(file);

      expect(storage.upload).toHaveBeenCalledTimes(1);
      expect(result.fileName).toBe('Julien-CV-2026.pdf');
    });

    it('utilise toujours la key fixe cv/cv.pdf', async () => {
      const file = mkFile();
      db.limit.mockResolvedValueOnce([]);
      db.returning.mockResolvedValueOnce([mkCvFile()]);

      await service.upsert(file);

      const uploadCall = storage.upload.mock.calls[0];
      expect(uploadCall[0]).toBe('portfolio-storage');
      expect(uploadCall[1]).toBe('cv/cv.pdf');
    });
  });

  describe('findLatestMetadata', () => {
    it('retourne la row si existe', async () => {
      const row = mkCvFile();
      db.limit.mockResolvedValueOnce([row]);
      await expect(service.findLatestMetadata()).resolves.toEqual(row);
    });

    it('retourne null si table vide', async () => {
      db.limit.mockResolvedValueOnce([]);
      await expect(service.findLatestMetadata()).resolves.toBeNull();
    });
  });

  describe('download', () => {
    it('retourne { buffer, metadata } si CV existe', async () => {
      const metadata = mkCvFile();
      db.limit.mockResolvedValueOnce([metadata]);
      const buffer = Buffer.from('pdf-bytes');
      storage.get.mockResolvedValueOnce({
        buffer,
        contentType: 'application/pdf',
      });

      const result = await service.download();

      expect(result.metadata).toEqual(metadata);
      expect(result.buffer).toEqual(buffer);
      expect(storage.get).toHaveBeenCalledWith(
        'portfolio-storage',
        'cv/cv.pdf',
      );
    });

    it('throw NotFoundException si pas de CV', async () => {
      db.limit.mockResolvedValueOnce([]);
      await expect(service.download()).rejects.toThrow(NotFoundException);
      expect(storage.get).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('supprime DB row puis S3 file dans cet ordre', async () => {
      const metadata = mkCvFile();
      db.limit.mockResolvedValueOnce([metadata]);
      // db.delete().where() résout via le builder default
      const callOrder: string[] = [];
      db.where.mockImplementationOnce(() => {
        callOrder.push('db-delete');
        return Promise.resolve(undefined) as never;
      });
      storage.delete.mockImplementationOnce(() => {
        callOrder.push('s3-delete');
        return Promise.resolve();
      });

      await service.remove();

      expect(callOrder).toEqual(['db-delete', 's3-delete']);
      expect(storage.delete).toHaveBeenCalledWith(
        'portfolio-storage',
        'cv/cv.pdf',
      );
    });

    it('throw NotFoundException si pas de CV', async () => {
      db.limit.mockResolvedValueOnce([]);
      await expect(service.remove()).rejects.toThrow(NotFoundException);
      expect(storage.delete).not.toHaveBeenCalled();
    });

    it("si S3.delete échoue après DB.delete → propage l'erreur", async () => {
      const metadata = mkCvFile();
      db.limit.mockResolvedValueOnce([metadata]);
      // db delete OK
      db.where.mockResolvedValueOnce(undefined);
      // S3 delete échoue
      storage.delete.mockRejectedValueOnce(new Error('S3 unreachable'));

      await expect(service.remove()).rejects.toThrow('S3 unreachable');
    });
  });
});
