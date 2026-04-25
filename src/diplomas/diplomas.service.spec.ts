import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { DiplomasService } from './diplomas.service';
import { DRIZZLE } from '../database/drizzle.constants';
import { createMockDb } from '../database/test-utils';
import type { Diploma } from '../database/schema/diplomas';

describe('DiplomasService', () => {
  let service: DiplomasService;
  let db: ReturnType<typeof createMockDb>;

  const mkDiploma = (overrides: Partial<Diploma> = {}): Diploma => ({
    id: 'diploma-uuid',
    title: 'Master Info',
    provider: 'Univ Lyon',
    shortDescription: 'Master en informatique',
    skills: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  beforeEach(async () => {
    db = createMockDb();
    const module: TestingModule = await Test.createTestingModule({
      providers: [DiplomasService, { provide: DRIZZLE, useValue: db }],
    }).compile();
    service = module.get(DiplomasService);
  });

  describe('findAll', () => {
    it('retourne tous les diplômes triés par createdAt ASC', async () => {
      const rows = [mkDiploma({ id: 'a' }), mkDiploma({ id: 'b' })];
      db.orderBy.mockResolvedValueOnce(rows);
      await expect(service.findAll()).resolves.toEqual(rows);
    });
  });

  describe('findById', () => {
    it('retourne le diplôme', async () => {
      const row = mkDiploma();
      db.limit.mockResolvedValueOnce([row]);
      await expect(service.findById('diploma-uuid')).resolves.toEqual(row);
    });

    it('throw NotFoundException si absent', async () => {
      db.limit.mockResolvedValueOnce([]);
      await expect(service.findById('nope')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('insère avec skills array roundtrip', async () => {
      const created = mkDiploma({ skills: ['TypeScript', 'NestJS'] });
      db.returning.mockResolvedValueOnce([created]);
      const result = await service.create({
        title: 'Master Info',
        provider: 'Univ Lyon',
        shortDescription: 'Master en informatique',
        skills: ['TypeScript', 'NestJS'],
      });
      expect(result.skills).toEqual(['TypeScript', 'NestJS']);
    });

    it('insère sans skills (default)', async () => {
      const created = mkDiploma({ skills: [] });
      db.returning.mockResolvedValueOnce([created]);
      const result = await service.create({
        title: 'Master Info',
        provider: 'Univ Lyon',
        shortDescription: 'Master en informatique',
      });
      expect(result.skills).toEqual([]);
    });
  });

  describe('update', () => {
    it('met à jour les skills', async () => {
      const updated = mkDiploma({ skills: ['Drizzle'] });
      db.returning.mockResolvedValueOnce([updated]);
      await expect(
        service.update('diploma-uuid', { skills: ['Drizzle'] }),
      ).resolves.toEqual(updated);
    });

    it('throw NotFoundException si id inconnu', async () => {
      db.returning.mockResolvedValueOnce([]);
      await expect(service.update('nope', { title: 'X' })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('remove', () => {
    it('supprime sans erreur', async () => {
      db.returning.mockResolvedValueOnce([{ id: 'diploma-uuid' }]);
      await expect(service.remove('diploma-uuid')).resolves.toBeUndefined();
    });

    it('throw NotFoundException si id inconnu', async () => {
      db.returning.mockResolvedValueOnce([]);
      await expect(service.remove('nope')).rejects.toThrow(NotFoundException);
    });
  });
});
