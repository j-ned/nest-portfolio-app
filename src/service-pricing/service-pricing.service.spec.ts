import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ServicePricingService } from './service-pricing.service';
import { DRIZZLE } from '../database/drizzle.constants';
import { createMockDb } from '../database/test-utils';
import type { ServicePricing } from '../database/schema/service-pricing';

describe('ServicePricingService', () => {
  let service: ServicePricingService;
  let db: ReturnType<typeof createMockDb>;

  const mkSP = (overrides: Partial<ServicePricing> = {}): ServicePricing => ({
    id: 'sp-uuid',
    title: 'Audit',
    description: 'Audit technique complet',
    price: 'À partir de 1500€',
    features: [],
    highlighted: false,
    enabled: true,
    order: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  beforeEach(async () => {
    db = createMockDb();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ServicePricingService,
        { provide: DRIZZLE, useValue: db },
      ],
    }).compile();
    service = module.get(ServicePricingService);
  });

  it('findAll retourne triée par order ASC', async () => {
    const rows = [mkSP({ id: 'a', order: 0 }), mkSP({ id: 'b', order: 1 })];
    db.orderBy.mockResolvedValueOnce(rows);
    await expect(service.findAll()).resolves.toEqual(rows);
  });

  it('findById retourne ou throw 404', async () => {
    const row = mkSP();
    db.limit.mockResolvedValueOnce([row]);
    await expect(service.findById('sp-uuid')).resolves.toEqual(row);

    db.limit.mockResolvedValueOnce([]);
    await expect(service.findById('nope')).rejects.toThrow(NotFoundException);
  });

  it('create insère et retourne', async () => {
    const created = mkSP();
    db.returning.mockResolvedValueOnce([created]);
    const result = await service.create({ title: 'Audit', description: 'X', price: '1500' });
    expect(result).toEqual(created);
  });

  it('update met à jour ou throw 404', async () => {
    const updated = mkSP({ title: 'Audit Plus' });
    db.returning.mockResolvedValueOnce([updated]);
    await expect(service.update('sp-uuid', { title: 'Audit Plus' })).resolves.toEqual(updated);

    db.returning.mockResolvedValueOnce([]);
    await expect(service.update('nope', { title: 'X' })).rejects.toThrow(NotFoundException);
  });

  it('remove supprime ou throw 404', async () => {
    db.returning.mockResolvedValueOnce([{ id: 'sp-uuid' }]);
    await expect(service.remove('sp-uuid')).resolves.toBeUndefined();

    db.returning.mockResolvedValueOnce([]);
    await expect(service.remove('nope')).rejects.toThrow(NotFoundException);
  });

  describe('reorder', () => {
    it('réassigne order = index pour chaque ID dans le tableau', async () => {
      // 1er select pour vérifier que tous les IDs existent
      db.where.mockResolvedValueOnce([
        { id: 'sp-a' }, { id: 'sp-b' }, { id: 'sp-c' },
      ]);
      // findAll retour final
      const finalRows = [
        mkSP({ id: 'sp-c', order: 0 }),
        mkSP({ id: 'sp-a', order: 1 }),
        mkSP({ id: 'sp-b', order: 2 }),
      ];
      db.orderBy.mockResolvedValueOnce(finalRows);

      const result = await service.reorder({ orderedIds: ['sp-c', 'sp-a', 'sp-b'] });
      expect(result).toEqual(finalRows);
      // Le builder.transaction a été appelé
      expect(db.transaction).toHaveBeenCalled();
    });

    it('throw BadRequestException si un ID est inexistant', async () => {
      db.where.mockResolvedValueOnce([{ id: 'sp-a' }, { id: 'sp-b' }]); // sp-c manquant
      await expect(service.reorder({ orderedIds: ['sp-c', 'sp-a', 'sp-b'] })).rejects.toThrow(BadRequestException);
    });

    it('accepte un tableau vide (no-op)', async () => {
      db.where.mockResolvedValueOnce([]);
      db.orderBy.mockResolvedValueOnce([]);
      const result = await service.reorder({ orderedIds: [] });
      expect(result).toEqual([]);
    });
  });
});
