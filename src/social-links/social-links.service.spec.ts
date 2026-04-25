import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { SocialLinksService } from './social-links.service';
import { DRIZZLE } from '../database/drizzle.constants';
import { createMockDb } from '../database/test-utils';
import type { SocialLink } from '../database/schema/social-links';

describe('SocialLinksService', () => {
  let service: SocialLinksService;
  let db: ReturnType<typeof createMockDb>;

  const mkLink = (overrides: Partial<SocialLink> = {}): SocialLink => ({
    id: 'link-uuid',
    icon: 'github',
    label: 'GitHub',
    href: 'https://github.com/jned',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  beforeEach(async () => {
    db = createMockDb();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SocialLinksService,
        { provide: DRIZZLE, useValue: db },
      ],
    }).compile();
    service = module.get(SocialLinksService);
  });

  describe('findAll', () => {
    it('retourne tous les liens triés par createdAt ASC', async () => {
      const rows = [mkLink({ id: 'a' }), mkLink({ id: 'b' })];
      db.orderBy.mockResolvedValueOnce(rows);
      await expect(service.findAll()).resolves.toEqual(rows);
    });
  });

  describe('findById', () => {
    it('retourne le lien si présent', async () => {
      const row = mkLink();
      db.limit.mockResolvedValueOnce([row]);
      await expect(service.findById('link-uuid')).resolves.toEqual(row);
    });

    it('throw NotFoundException si absent', async () => {
      db.limit.mockResolvedValueOnce([]);
      await expect(service.findById('nope')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('insère et retourne la nouvelle ligne', async () => {
      const created = mkLink({ icon: 'linkedin', label: 'LinkedIn', href: 'https://linkedin.com/in/jned' });
      db.returning.mockResolvedValueOnce([created]);
      const result = await service.create({ icon: 'linkedin', label: 'LinkedIn', href: 'https://linkedin.com/in/jned' });
      expect(result).toEqual(created);
    });
  });

  describe('update', () => {
    it('met à jour et retourne la ligne', async () => {
      const updated = mkLink({ label: 'Mon GitHub' });
      db.returning.mockResolvedValueOnce([updated]);
      await expect(service.update('link-uuid', { label: 'Mon GitHub' })).resolves.toEqual(updated);
    });

    it('throw NotFoundException si id inconnu', async () => {
      db.returning.mockResolvedValueOnce([]);
      await expect(service.update('nope', { label: 'X' })).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('supprime sans erreur si la ligne existe', async () => {
      db.returning.mockResolvedValueOnce([{ id: 'link-uuid' }]);
      await expect(service.remove('link-uuid')).resolves.toBeUndefined();
    });

    it('throw NotFoundException si id inconnu', async () => {
      db.returning.mockResolvedValueOnce([]);
      await expect(service.remove('nope')).rejects.toThrow(NotFoundException);
    });
  });
});
