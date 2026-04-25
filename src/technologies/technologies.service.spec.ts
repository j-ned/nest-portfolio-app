import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { TechnologiesService } from './technologies.service';
import { DRIZZLE } from '../database/drizzle.constants';
import { createMockDb } from '../database/test-utils';
import type { Technology } from '../database/schema/technologies';

describe('TechnologiesService', () => {
  let service: TechnologiesService;
  let db: ReturnType<typeof createMockDb>;

  const mkTech = (overrides: Partial<Technology> = {}): Technology => ({
    id: 'tech-uuid',
    name: 'TypeScript',
    category: 'language',
    icon: 'devicon-typescript-plain',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  beforeEach(async () => {
    db = createMockDb();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TechnologiesService,
        { provide: DRIZZLE, useValue: db },
      ],
    }).compile();
    service = module.get(TechnologiesService);
  });

  it('findAll retourne toutes les techs triées par createdAt ASC', async () => {
    const rows = [mkTech({ id: 'a' }), mkTech({ id: 'b' })];
    db.orderBy.mockResolvedValueOnce(rows);
    await expect(service.findAll()).resolves.toEqual(rows);
  });

  it('findById retourne la tech', async () => {
    const row = mkTech();
    db.limit.mockResolvedValueOnce([row]);
    await expect(service.findById('tech-uuid')).resolves.toEqual(row);
  });

  it('findById throw NotFoundException si absent', async () => {
    db.limit.mockResolvedValueOnce([]);
    await expect(service.findById('nope')).rejects.toThrow(NotFoundException);
  });

  it('create insère et retourne', async () => {
    const created = mkTech();
    db.returning.mockResolvedValueOnce([created]);
    const result = await service.create({ name: 'TypeScript', category: 'language', icon: 'devicon-typescript-plain' });
    expect(result).toEqual(created);
  });

  it('update met à jour ou throw 404', async () => {
    const updated = mkTech({ name: 'TS' });
    db.returning.mockResolvedValueOnce([updated]);
    await expect(service.update('tech-uuid', { name: 'TS' })).resolves.toEqual(updated);

    db.returning.mockResolvedValueOnce([]);
    await expect(service.update('nope', { name: 'X' })).rejects.toThrow(NotFoundException);
  });

  it('remove supprime ou throw 404', async () => {
    db.returning.mockResolvedValueOnce([{ id: 'tech-uuid' }]);
    await expect(service.remove('tech-uuid')).resolves.toBeUndefined();

    db.returning.mockResolvedValueOnce([]);
    await expect(service.remove('nope')).rejects.toThrow(NotFoundException);
  });
});
