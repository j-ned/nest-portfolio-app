import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { asc, between, eq, gte } from 'drizzle-orm';
import { DRIZZLE } from '../database/drizzle.constants';
import type { Database, DbExecutor } from '../database/drizzle.types';
import {
  availabilityClosures,
  availabilityOverrides,
  availabilityRules,
  BOOKING_SETTING_ROW_ID,
  bookingSettings,
  DEFAULT_CLOSE_PUBLIC_HOLIDAYS,
  type AvailabilityClosure,
  type AvailabilityRule,
} from '../database/schema';
import { lastAllowedDay } from './calendar-month';
import { publicHolidayName } from './french-public-holidays';
import { toParisDate } from './paris-time';
import {
  type CalendarDay,
  type DayOverrideKind,
  toCalendarDay,
} from './resolve-day';

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

  /** Interrupteur des fériés ; ligne absente → défaut du schéma (fériés fermés). */
  async readClosePublicHolidays(
    executor: DbExecutor = this.db,
  ): Promise<boolean> {
    const [setting] = await executor
      .select({ closePublicHolidays: bookingSettings.closePublicHolidays })
      .from(bookingSettings)
      .where(eq(bookingSettings.id, BOOKING_SETTING_ROW_ID))
      .limit(1);
    return setting?.closePublicHolidays ?? DEFAULT_CLOSE_PUBLIC_HOLIDAYS;
  }

  /** Exceptions par date de `from` à `to` inclus (dates de Paris). */
  async listOverrides(
    executor: DbExecutor,
    from: string,
    to: string,
  ): Promise<ReadonlyMap<string, DayOverrideKind>> {
    const rows = await executor
      .select({
        day: availabilityOverrides.day,
        kind: availabilityOverrides.kind,
      })
      .from(availabilityOverrides)
      .where(between(availabilityOverrides.day, from, to));
    return new Map(rows.map(({ day, kind }) => [day, kind]));
  }

  /**
   * Écrit l'état souhaité d'un jour (ADR-0027) : l'exception est supprimée si le jour aurait cet
   * état sans elle, insérée ou remplacée sinon. Refus avant toute écriture, dans l'ordre : passé,
   * au-delà du calendrier, sous une fermeture. Rend le jour relu dans la même transaction.
   */
  setDayOpen(date: string, open: boolean): Promise<CalendarDay> {
    return this.db.transaction(async (tx) => {
      const today = toParisDate(new Date());
      // Dates `YYYY-MM-DD` : l'ordre lexical est l'ordre chronologique.
      if (date < today) {
        throw new UnprocessableEntityException({
          error: 'day_in_past',
          message: 'Ce jour est passé.',
        });
      }
      if (date > lastAllowedDay(today)) {
        throw new UnprocessableEntityException({
          error: 'day_out_of_range',
          message: 'Ce jour est au-delà du calendrier.',
        });
      }
      const [closePublicHolidays, closures, rules] = await Promise.all([
        this.readClosePublicHolidays(tx),
        this.listClosures(tx),
        this.listRules(tx),
      ]);
      if (
        closures.some(
          ({ startsOn, endsOn }) => startsOn <= date && date <= endsOn,
        )
      ) {
        throw new ConflictException({
          error: 'day_in_closure',
          message: 'Ce jour est couvert par une fermeture.',
        });
      }

      const openByRule = !(
        closePublicHolidays && publicHolidayName(date) !== null
      );
      if (open === openByRule) {
        await tx
          .delete(availabilityOverrides)
          .where(eq(availabilityOverrides.day, date));
      } else {
        const kind: DayOverrideKind = open ? 'open' : 'closed';
        await tx
          .insert(availabilityOverrides)
          .values({ day: date, kind })
          .onConflictDoUpdate({
            target: availabilityOverrides.day,
            set: { kind },
          });
      }

      const overrides = await this.listOverrides(tx, date, date);
      return toCalendarDay(
        date,
        { today, closures, overrides, closePublicHolidays },
        rules,
        closures,
      );
    });
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
