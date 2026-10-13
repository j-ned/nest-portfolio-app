import { Inject, Injectable } from '@nestjs/common';
import { asc, gte } from 'drizzle-orm';
import { DRIZZLE } from '../database/drizzle.constants';
import type { Database, DbExecutor } from '../database/drizzle.types';
import {
  availabilityClosures,
  availabilityRules,
  type AvailabilityClosure,
  type AvailabilityRule,
} from '../database/schema';
import { toParisDate } from './paris-time';

@Injectable()
export class AvailabilityService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  listRules(executor: DbExecutor = this.db): Promise<AvailabilityRule[]> {
    return executor
      .select()
      .from(availabilityRules)
      .orderBy(
        asc(availabilityRules.weekday),
        asc(availabilityRules.startMinute),
      );
  }

  /** Fermetures non terminées : `endsOn` à partir d'aujourd'hui, date de Paris. */
  listClosures(executor: DbExecutor = this.db): Promise<AvailabilityClosure[]> {
    return executor
      .select()
      .from(availabilityClosures)
      .where(gte(availabilityClosures.endsOn, toParisDate(new Date())))
      .orderBy(asc(availabilityClosures.startsOn));
  }
}
