import { Inject, Injectable } from '@nestjs/common';
import { asc, gte } from 'drizzle-orm';
import { DRIZZLE } from '../database/drizzle.constants';
import type { Database } from '../database/drizzle.types';
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

  listRules(): Promise<AvailabilityRule[]> {
    return this.db
      .select()
      .from(availabilityRules)
      .orderBy(
        asc(availabilityRules.weekday),
        asc(availabilityRules.startMinute),
      );
  }

  /** Fermetures non terminées : `endsOn` à partir d'aujourd'hui, date de Paris. */
  listClosures(): Promise<AvailabilityClosure[]> {
    return this.db
      .select()
      .from(availabilityClosures)
      .where(gte(availabilityClosures.endsOn, toParisDate(new Date())))
      .orderBy(asc(availabilityClosures.startsOn));
  }
}
