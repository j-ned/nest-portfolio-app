import { Test, TestingModule } from '@nestjs/testing';
import { InternalServerErrorException } from '@nestjs/common';
import { HeroService } from './hero.service';
import { DRIZZLE } from '../database/drizzle.constants';
import { createMockDb } from '../database/test-utils';
import type { Hero } from '../database/schema/hero';

describe('HeroService', () => {
  let service: HeroService;
  let db: ReturnType<typeof createMockDb>;

  const mkHero = (overrides: Partial<Hero> = {}): Hero => ({
    id: 'hero-uuid',
    name: '',
    tagline: '',
    availability: '',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  beforeEach(async () => {
    db = createMockDb();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HeroService,
        { provide: DRIZZLE, useValue: db },
      ],
    }).compile();
    service = module.get(HeroService);
  });

  describe('findOne', () => {
    it('retourne le singleton', async () => {
      const row = mkHero({ name: 'Julien' });
      db.limit.mockResolvedValueOnce([row]);
      await expect(service.findOne()).resolves.toEqual(row);
    });

    it('throw InternalServerErrorException si absent', async () => {
      db.limit.mockResolvedValueOnce([]);
      await expect(service.findOne()).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe('update', () => {
    it('met à jour et retourne la ligne', async () => {
      const existing = mkHero();
      const updated = mkHero({ name: 'Julien', tagline: 'Dev fullstack' });
      db.limit.mockResolvedValueOnce([existing]);
      db.returning.mockResolvedValueOnce([updated]);
      const result = await service.update({ name: 'Julien', tagline: 'Dev fullstack' });
      expect(result).toEqual(updated);
    });
  });
});
