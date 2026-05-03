import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { BiographyService } from './biography.service';
import { DRIZZLE } from '../database/drizzle.constants';
import { createMockDb } from '../database/test-utils';

describe('BiographyService', () => {
  let service: BiographyService;
  let db: ReturnType<typeof createMockDb>;

  const mkBiographyRow = (
    overrides: Partial<{
      id: string;
      title: string;
      paragraphs: string[];
      updatedAt: Date;
    }> = {},
  ) => ({
    id: 'profile-uuid',
    title: '',
    paragraphs: [] as string[],
    updatedAt: new Date('2026-05-03T10:00:00Z'),
    ...overrides,
  });

  beforeEach(async () => {
    db = createMockDb();
    const module: TestingModule = await Test.createTestingModule({
      providers: [BiographyService, { provide: DRIZZLE, useValue: db }],
    }).compile();
    service = module.get(BiographyService);
  });

  describe('findOne', () => {
    it('retourne biography depuis profile row (subset)', async () => {
      const row = mkBiographyRow({
        title: 'À propos',
        paragraphs: ['P1', 'P2'],
      });
      db.limit.mockResolvedValueOnce([row]);
      await expect(service.findOne()).resolves.toEqual(row);
    });

    it('throw NotFoundException si pas de profile', async () => {
      db.limit.mockResolvedValueOnce([]);
      await expect(service.findOne()).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it("applique title seul (n'écrase pas paragraphs)", async () => {
      const existing = mkBiographyRow({ title: 'Old', paragraphs: ['P1'] });
      const updated = mkBiographyRow({ title: 'New', paragraphs: ['P1'] });
      db.limit.mockResolvedValueOnce([existing]);
      db.returning.mockResolvedValueOnce([updated]);

      const result = await service.update({ title: 'New' });
      expect(result).toEqual(updated);
    });

    it("applique paragraphs seul (n'écrase pas title)", async () => {
      const existing = mkBiographyRow({ title: 'Title', paragraphs: ['Old'] });
      const updated = mkBiographyRow({
        title: 'Title',
        paragraphs: ['New', 'Para'],
      });
      db.limit.mockResolvedValueOnce([existing]);
      db.returning.mockResolvedValueOnce([updated]);

      const result = await service.update({ paragraphs: ['New', 'Para'] });
      expect(result).toEqual(updated);
    });
  });
});
