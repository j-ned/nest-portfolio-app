import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { asc, eq, gte } from 'drizzle-orm';
import { DRIZZLE } from '../database/drizzle.constants';
import type { Database, DbExecutor } from '../database/drizzle.types';
import {
  availabilityClosures,
  availabilityRules,
  type AvailabilityClosure,
  type AvailabilityRule,
} from '../database/schema';
import { toParisDate } from './paris-time';

export type AvailabilityRuleInput = Pick<
  AvailabilityRule,
  'weekday' | 'startMinute' | 'endMinute'
>;

export type AvailabilityClosureInput = {
  startsOn: string;
  endsOn: string;
  reason?: string;
};

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

  /**
   * Remplace tout le bloc hebdomadaire dans une transaction : validé avant d'écrire, l'ancien
   * bloc reste intact si le nouveau est refusé.
   */
  async replaceRules(
    rules: AvailabilityRuleInput[],
  ): Promise<AvailabilityRule[]> {
    assertValidRules(rules);
    return this.db.transaction(async (tx) => {
      await tx.delete(availabilityRules);
      if (rules.length > 0) {
        await tx.insert(availabilityRules).values(
          rules.map(({ weekday, startMinute, endMinute }) => ({
            weekday,
            startMinute,
            endMinute,
          })),
        );
      }
      return this.listRules(tx);
    });
  }

  async createClosure({
    startsOn,
    endsOn,
    reason,
  }: AvailabilityClosureInput): Promise<AvailabilityClosure> {
    // Dates `YYYY-MM-DD` validées par le DTO : l'ordre lexical est l'ordre chronologique.
    if (endsOn < startsOn) {
      throw new BadRequestException(
        'La fin de la fermeture précède son début.',
      );
    }
    const [created] = await this.db
      .insert(availabilityClosures)
      .values({ startsOn, endsOn, reason: reason || null })
      .returning();
    return created;
  }

  async deleteClosure(id: string): Promise<void> {
    const deleted = await this.db
      .delete(availabilityClosures)
      .where(eq(availabilityClosures.id, id))
      .returning();
    if (deleted.length === 0) {
      throw new NotFoundException('Fermeture introuvable.');
    }
  }
}

/** Fin après début, et aucune plage du même jour ne chevauche une autre (adjacentes acceptées). */
const assertValidRules = (rules: AvailabilityRuleInput[]): void => {
  if (rules.some((rule) => rule.endMinute <= rule.startMinute)) {
    throw new BadRequestException('Une plage doit finir après son début.');
  }
  const sorted = [...rules].sort(
    (a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute,
  );
  const overlaps = sorted.some(
    (rule, i) =>
      i > 0 &&
      rule.weekday === sorted[i - 1].weekday &&
      rule.startMinute < sorted[i - 1].endMinute,
  );
  if (overlaps) {
    throw new BadRequestException({
      error: 'rules_overlap',
      message: 'Deux plages du même jour se chevauchent.',
    });
  }
};
