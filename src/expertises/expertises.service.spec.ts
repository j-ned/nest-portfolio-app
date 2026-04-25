import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ExpertisesService } from './expertises.service';
import { DRIZZLE } from '../database/drizzle.constants';
import { createMockDb } from '../database/test-utils';
import type { Expertise } from '../database/schema/expertises';

describe('ExpertisesService', () => {
  let service: ExpertisesService;
  let db: ReturnType<typeof createMockDb>;

  const mkExpertise = (overrides: Partial<Expertise> = {}): Expertise => ({
    id: 'exp-uuid',
    type: 'offer',
    title: 'Architecture',
    description: "Conception d'architectures backend",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  beforeEach(async () => {
    db = createMockDb();
    const module: TestingModule = await Test.createTestingModule({
      providers: [ExpertisesService, { provide: DRIZZLE, useValue: db }],
    }).compile();
    service = module.get(ExpertisesService);
  });

  it('findOffers retourne uniquement les offers triées par createdAt ASC', async () => {
    const rows = [mkExpertise({ id: 'a', type: 'offer' })];
    db.orderBy.mockResolvedValueOnce(rows);
    await expect(service.findOffers()).resolves.toEqual(rows);
  });

  it('findSeeks retourne uniquement les seeks triées par createdAt ASC', async () => {
    const rows = [mkExpertise({ id: 'b', type: 'seek' })];
    db.orderBy.mockResolvedValueOnce(rows);
    await expect(service.findSeeks()).resolves.toEqual(rows);
  });

  it('findById retourne le détail incluant le type', async () => {
    const row = mkExpertise({ type: 'seek' });
    db.limit.mockResolvedValueOnce([row]);
    await expect(service.findById('exp-uuid')).resolves.toEqual(row);
  });

  it('findById throw NotFoundException si absent', async () => {
    db.limit.mockResolvedValueOnce([]);
    await expect(service.findById('nope')).rejects.toThrow(NotFoundException);
  });

  it('create injecte type=offer si createOffer', async () => {
    const created = mkExpertise({ type: 'offer' });
    db.returning.mockResolvedValueOnce([created]);
    const result = await service.create('offer', {
      title: 'X',
      description: 'Y',
    });
    expect(result.type).toBe('offer');
    expect(db.values).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'offer' }),
    );
  });

  it('create injecte type=seek si createSeek', async () => {
    const created = mkExpertise({ type: 'seek' });
    db.returning.mockResolvedValueOnce([created]);
    const result = await service.create('seek', {
      title: 'X',
      description: 'Y',
    });
    expect(result.type).toBe('seek');
    expect(db.values).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'seek' }),
    );
  });

  it('update ne change PAS le type', async () => {
    const updated = mkExpertise({ title: 'New title' });
    db.returning.mockResolvedValueOnce([updated]);
    await service.update('exp-uuid', { title: 'New title' });
    // Vérifier que le set NE contient PAS de champ "type"
    expect(db.set).toHaveBeenCalledWith(
      expect.not.objectContaining({ type: expect.anything() }),
    );
  });

  it('update throw NotFoundException si id inconnu', async () => {
    db.returning.mockResolvedValueOnce([]);
    await expect(service.update('nope', { title: 'X' })).rejects.toThrow(
      NotFoundException,
    );
  });

  it('remove supprime ou throw 404', async () => {
    db.returning.mockResolvedValueOnce([{ id: 'exp-uuid' }]);
    await expect(service.remove('exp-uuid')).resolves.toBeUndefined();

    db.returning.mockResolvedValueOnce([]);
    await expect(service.remove('nope')).rejects.toThrow(NotFoundException);
  });
});
