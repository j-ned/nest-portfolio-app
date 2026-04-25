import { Test, TestingModule } from '@nestjs/testing';
import { InternalServerErrorException } from '@nestjs/common';
import { ProfileService } from './profile.service';
import { DRIZZLE } from '../database/drizzle.constants';
import { createMockDb } from '../database/test-utils';
import type { Profile } from '../database/schema/profile';

describe('ProfileService', () => {
  let service: ProfileService;
  let db: ReturnType<typeof createMockDb>;

  const mkProfile = (overrides: Partial<Profile> = {}): Profile => ({
    id: 'profile-uuid',
    displayName: '',
    location: '',
    avatarUrl: '',
    isAvailable: true,
    availabilityMessage: '',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  beforeEach(async () => {
    db = createMockDb();
    const module: TestingModule = await Test.createTestingModule({
      providers: [ProfileService, { provide: DRIZZLE, useValue: db }],
    }).compile();
    service = module.get(ProfileService);
  });

  describe('findOne', () => {
    it('retourne le singleton quand il existe', async () => {
      const row = mkProfile({ displayName: 'Julien' });
      db.limit.mockResolvedValueOnce([row]);
      await expect(service.findOne()).resolves.toEqual(row);
    });

    it('throw InternalServerErrorException si singleton absent', async () => {
      db.limit.mockResolvedValueOnce([]);
      await expect(service.findOne()).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe('update', () => {
    it('met à jour les champs fournis et retourne la ligne', async () => {
      const existing = mkProfile();
      const updated = mkProfile({ displayName: 'Julien', location: 'Lyon' });
      // findOne d'abord (select.from.limit), puis update.set.where.returning
      db.limit.mockResolvedValueOnce([existing]);
      db.returning.mockResolvedValueOnce([updated]);
      const result = await service.update({
        displayName: 'Julien',
        location: 'Lyon',
      });
      expect(result).toEqual(updated);
    });
  });
});
