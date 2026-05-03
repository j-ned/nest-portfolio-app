import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { HighlightsService } from './highlights.service';
import { DRIZZLE } from '../database/drizzle.constants';
import { createMockDb } from '../database/test-utils';
import type { Highlight } from '../database/schema';

describe('HighlightsService', () => {
  let service: HighlightsService;
  let db: ReturnType<typeof createMockDb>;

  const mkHighlight = (overrides: Partial<Highlight> = {}): Highlight => ({
    id: 'hl-uuid',
    title: 'Title',
    description: 'Desc',
    icon: 'star',
    section: 'profile',
    order: 0,
    createdAt: new Date('2026-05-03T10:00:00Z'),
    updatedAt: new Date('2026-05-03T10:00:00Z'),
    ...overrides,
  });

  beforeEach(async () => {
    db = createMockDb();
    const module: TestingModule = await Test.createTestingModule({
      providers: [HighlightsService, { provide: DRIZZLE, useValue: db }],
    }).compile();
    service = module.get(HighlightsService);
  });

  describe('findAll', () => {
    it("findAll('profile') retourne uniquement les highlights section='profile' triés par order", async () => {
      const rows = [
        mkHighlight({ id: 'a', order: 0 }),
        mkHighlight({ id: 'b', order: 1 }),
      ];
      db.orderBy.mockResolvedValueOnce(rows);
      await expect(service.findAll('profile')).resolves.toEqual(rows);
    });

    it("findAll('home') retourne uniquement les highlights section='home'", async () => {
      const rows = [mkHighlight({ id: 'c', section: 'home' })];
      db.orderBy.mockResolvedValueOnce(rows);
      await expect(service.findAll('home')).resolves.toEqual(rows);
    });
  });

  describe('findOne', () => {
    it("findOne(id, 'profile') retourne le highlight si même section", async () => {
      const row = mkHighlight({ id: 'a', section: 'profile' });
      db.limit.mockResolvedValueOnce([row]);
      await expect(service.findOne('a', 'profile')).resolves.toEqual(row);
    });

    it("findOne(id, 'home') throw NotFoundException si pas de match", async () => {
      db.limit.mockResolvedValueOnce([]);
      await expect(service.findOne('a', 'home')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    it("create(dto, 'profile') insère avec section='profile' (force)", async () => {
      const created = mkHighlight({ section: 'profile' });
      db.returning.mockResolvedValueOnce([created]);
      const result = await service.create(
        { title: 'T', description: 'D', icon: 'star' },
        'profile',
      );
      expect(result).toEqual(created);
    });

    it("create(dto, 'home') insère avec section='home' (force)", async () => {
      const created = mkHighlight({ section: 'home' });
      db.returning.mockResolvedValueOnce([created]);
      const result = await service.create(
        { title: 'T', description: 'D', icon: 'star' },
        'home',
      );
      expect(result).toEqual(created);
    });
  });

  describe('update', () => {
    it("update(id, dto, 'profile') met à jour si même section", async () => {
      const updated = mkHighlight({
        id: 'a',
        title: 'New',
        section: 'profile',
      });
      db.returning.mockResolvedValueOnce([updated]);
      await expect(
        service.update('a', { title: 'New' }, 'profile'),
      ).resolves.toEqual(updated);
    });
  });

  describe('remove', () => {
    it("remove(id, 'profile') ok si même section", async () => {
      db.returning.mockResolvedValueOnce([mkHighlight({ id: 'a' })]);
      await expect(service.remove('a', 'profile')).resolves.toBeUndefined();
    });

    it("remove(id, 'home') throw NotFoundException si pas de match", async () => {
      db.returning.mockResolvedValueOnce([]);
      await expect(service.remove('a', 'home')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
