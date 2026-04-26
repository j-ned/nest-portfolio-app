/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { InternalServerErrorException } from '@nestjs/common';
import { ProfileService } from './profile.service';
import { DRIZZLE } from '../database/drizzle.constants';
import { createMockDb } from '../database/test-utils';
import { StorageService } from '../storage/storage.service';
import type { Profile } from '../database/schema/profile';

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

  describe('update', () => {
    it("met à jour les champs simples et retourne Profile avec avatarUrl ''", async () => {
      const existing = mkProfile({ avatarUrl: '' });
      const updated = mkProfile({
        displayName: 'Julien',
        location: 'Lyon',
        avatarUrl: '',
      });
      db.limit.mockResolvedValueOnce([existing]);
      db.returning.mockResolvedValueOnce([updated]);
      const result = await service.update({
        displayName: 'Julien',
        location: 'Lyon',
      });
      expect(result.displayName).toBe('Julien');
      expect(result.avatarUrl).toBe('');
    });
  });
});
