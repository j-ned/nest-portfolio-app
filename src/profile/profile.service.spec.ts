/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { InternalServerErrorException } from '@nestjs/common';
import { ProfileService } from './profile.service';
import { DRIZZLE } from '../database/drizzle.constants';
import { createMockDb } from '../database/test-utils';
import { StorageService } from '../storage/storage.service';
import type { Profile } from '../database/schema';

describe('ProfileService', () => {
  let service: ProfileService;
  let db: ReturnType<typeof createMockDb>;
  let storage: jest.Mocked<StorageService>;

  const mkProfile = (overrides: Partial<Profile> = {}): Profile => ({
    id: 'profile-uuid',
    displayName: '',
    location: '',
    avatarUrl: '',
    isAvailable: true,
    availabilityMessage: '',
    createdAt: new Date('2026-04-26T00:00:00Z'),
    updatedAt: new Date('2026-04-26T00:00:00Z'),
    ...overrides,
  });

  beforeEach(async () => {
    db = createMockDb();
    storage = {
      upload: jest.fn().mockResolvedValue(undefined),
      get: jest.fn(),
      delete: jest.fn().mockResolvedValue(undefined),
      list: jest.fn(),
      getPublicUrl: jest.fn().mockReturnValue('https://example.test/url'),
    } as unknown as jest.Mocked<StorageService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProfileService,
        { provide: DRIZZLE, useValue: db },
        { provide: StorageService, useValue: storage },
      ],
    }).compile();
    service = module.get(ProfileService);
  });

  describe('findOne', () => {
    it('retourne avatarUrl transformée en URL publique si key non vide', async () => {
      const row = mkProfile({ avatarUrl: 'avatar/avatar.webp' });
      db.limit.mockResolvedValueOnce([row]);
      const result = await service.findOne();
      expect(result.avatarUrl).toBe('https://example.test/url');
      expect(storage.getPublicUrl).toHaveBeenCalledWith(
        'portfolio-storage',
        'avatar/avatar.webp',
      );
    });

    it("retourne avatarUrl: '' si key vide", async () => {
      const row = mkProfile({ avatarUrl: '' });
      db.limit.mockResolvedValueOnce([row]);
      const result = await service.findOne();
      expect(result.avatarUrl).toBe('');
      expect(storage.getPublicUrl).not.toHaveBeenCalled();
    });

    it('throw InternalServerErrorException si singleton absent', async () => {
      db.limit.mockResolvedValueOnce([]);
      await expect(service.findOne()).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe('uploadAvatar', () => {
    const file = {
      buffer: Buffer.from('fake'),
      mimetype: 'image/webp',
      size: 100,
    } as Express.Multer.File;

    it('upload + DB write, pas de delete si pas de key existante', async () => {
      const existing = mkProfile({ avatarUrl: '' });
      const updated = mkProfile({ avatarUrl: 'avatar/avatar.webp' });
      db.limit.mockResolvedValueOnce([existing]);
      db.returning.mockResolvedValueOnce([updated]);
      const result = await service.uploadAvatar(file);
      expect(storage.upload).toHaveBeenCalledWith(
        'portfolio-storage',
        'avatar/avatar.webp',
        file.buffer,
        'image/webp',
      );
      expect(storage.delete).not.toHaveBeenCalled();
      expect(result.avatarUrl).toBe('https://example.test/url');
    });

    it('replace même extension → upload, pas de delete (clé identique)', async () => {
      const existing = mkProfile({ avatarUrl: 'avatar/avatar.webp' });
      const updated = mkProfile({ avatarUrl: 'avatar/avatar.webp' });
      db.limit.mockResolvedValueOnce([existing]);
      db.returning.mockResolvedValueOnce([updated]);
      await service.uploadAvatar(file);
      expect(storage.upload).toHaveBeenCalled();
      expect(storage.delete).not.toHaveBeenCalled();
    });

    it('replace extension différente → upload + DB + delete ancienne', async () => {
      const existing = mkProfile({ avatarUrl: 'avatar/avatar.jpg' });
      const updated = mkProfile({ avatarUrl: 'avatar/avatar.webp' });
      db.limit.mockResolvedValueOnce([existing]);
      db.returning.mockResolvedValueOnce([updated]);
      await service.uploadAvatar(file);
      expect(storage.upload).toHaveBeenCalledWith(
        'portfolio-storage',
        'avatar/avatar.webp',
        file.buffer,
        'image/webp',
      );
      expect(storage.delete).toHaveBeenCalledWith(
        'portfolio-storage',
        'avatar/avatar.jpg',
      );
    });

    it('retourne Profile avec avatarUrl transformée en URL', async () => {
      const existing = mkProfile({ avatarUrl: '' });
      const updated = mkProfile({ avatarUrl: 'avatar/avatar.webp' });
      db.limit.mockResolvedValueOnce([existing]);
      db.returning.mockResolvedValueOnce([updated]);
      const result = await service.uploadAvatar(file);
      expect(result.avatarUrl).toBe('https://example.test/url');
      expect(storage.getPublicUrl).toHaveBeenCalledWith(
        'portfolio-storage',
        'avatar/avatar.webp',
      );
    });

    it('throw UnprocessableEntityException si mimetype non whitelisté', async () => {
      const fileWithBadMime = {
        buffer: Buffer.from('fake'),
        mimetype: 'application/octet-stream',
        size: 100,
      } as Express.Multer.File;
      const existing = mkProfile({ avatarUrl: '' });
      db.limit.mockResolvedValueOnce([existing]);
      await expect(service.uploadAvatar(fileWithBadMime)).rejects.toThrow(
        'Unsupported file type: application/octet-stream',
      );
      expect(storage.upload).not.toHaveBeenCalled();
    });
  });
});
