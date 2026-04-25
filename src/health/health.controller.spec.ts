import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { DRIZZLE } from '../database/drizzle.constants';

describe('HealthController', () => {
  let controller: HealthController;
  let dbExecute: jest.Mock;

  beforeEach(async () => {
    dbExecute = jest.fn();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: DRIZZLE, useValue: { execute: dbExecute } }],
    }).compile();
    controller = module.get<HealthController>(HealthController);
  });

  it('retourne status:ok quand la DB répond', async () => {
    dbExecute.mockResolvedValueOnce([{ '?column?': 1 }]);
    const result = await controller.check();
    expect(result.status).toBe('ok');
    expect(result.db.status).toBe('up');
    expect(typeof result.db.latencyMs).toBe('number');
    expect(result.db.latencyMs).toBeGreaterThanOrEqual(0);
    expect(typeof result.uptime).toBe('number');
    expect(result.version).toBeDefined();
    expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('retourne status:degraded quand la DB échoue', async () => {
    dbExecute.mockRejectedValueOnce(new Error('connection refused'));
    const result = await controller.check();
    expect(result.status).toBe('degraded');
    expect(result.db.status).toBe('down');
    expect(result.db.latencyMs).toBeNull();
  });
});
