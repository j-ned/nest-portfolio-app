import { Test, type TestingModule } from '@nestjs/testing';
import { type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { DRIZZLE } from '../database/drizzle.constants';
import { createMockDb } from '../database/test-utils';
import { AvailabilityService } from './availability.service';
import {
  anAvailabilityClosure,
  anAvailabilityRule,
} from './booking-test-builders';

const render = (fragment: unknown) =>
  new PgDialect({ casing: 'snake_case' }).sqlToQuery(fragment as SQL);

describe('AvailabilityService (lecture)', () => {
  let service: AvailabilityService;
  let db: ReturnType<typeof createMockDb>;

  beforeEach(async () => {
    db = createMockDb();
    const module: TestingModule = await Test.createTestingModule({
      providers: [AvailabilityService, { provide: DRIZZLE, useValue: db }],
    }).compile();
    service = module.get(AvailabilityService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('listRules', () => {
    it('Given des plages en base, When listRules, Then elles sont rendues telles que lues', async () => {
      const rules = [
        anAvailabilityRule({ weekday: 1, startMinute: 540, endMinute: 720 }),
        anAvailabilityRule({ weekday: 3, startMinute: 840, endMinute: 1080 }),
      ];
      db.orderBy.mockResolvedValueOnce(rules);

      await expect(service.listRules()).resolves.toEqual(rules);
    });
  });

  describe('listClosures', () => {
    it.each([
      ['2026-10-25T22:30:00Z', '2026-10-25'],
      ['2026-10-25T23:30:00Z', '2026-10-26'],
    ])(
      'Given il est %s, When listClosures, Then seules les fermetures finissant le %s (date de Paris) ou après sont lues',
      async (now, parisToday) => {
        jest.useFakeTimers().setSystemTime(new Date(now));
        const closures = [
          anAvailabilityClosure({ startsOn: parisToday, endsOn: parisToday }),
        ];
        db.orderBy.mockResolvedValueOnce(closures);

        await expect(service.listClosures()).resolves.toEqual(closures);
        expect(db.where).toHaveBeenCalledTimes(1);
        const [condition] = db.where.mock.calls[0] as [unknown];
        expect(render(condition).params).toEqual([parisToday]);
      },
    );
  });
});
