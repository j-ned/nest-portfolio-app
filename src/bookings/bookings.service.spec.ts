/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { DRIZZLE } from '../database/drizzle.constants';
import { createMockDb } from '../database/test-utils';
import { AppConfigService } from '../config/app-config.service';
import { MailerService } from '../mailer/mailer.service';
import type { Booking, DisabledDate } from '../database/schema/bookings';

describe('BookingsService', () => {
  let service: BookingsService;
  let db: ReturnType<typeof createMockDb>;
  let cfg: { contactEmail: string };
  let mailer: jest.Mocked<MailerService>;

  const mkBooking = (overrides: Partial<Booking> = {}): Booking => ({
    id: '11111111-1111-1111-1111-111111111111',
    date: '2026-04-26',
    startTime: '14:00',
    duration: 60,
    name: 'Visitor',
    email: 'visitor@example.com',
    phone: '0612345678',
    subject: 'Consultation',
    message: 'Hello',
    createdAt: new Date('2026-04-26T00:00:00Z'),
    ...overrides,
  });

  const mkDisabledDate = (
    overrides: Partial<DisabledDate> = {},
  ): DisabledDate => ({
    id: '22222222-2222-2222-2222-222222222222',
    date: '2026-12-25',
    reason: 'Christmas',
    ...overrides,
  });

  beforeEach(async () => {
    db = createMockDb();
    cfg = { contactEmail: 'admin@test.local' };
    mailer = {
      sendMail: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<MailerService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BookingsService,
        { provide: DRIZZLE, useValue: db },
        {
          provide: AppConfigService,
          useValue: cfg,
        },
        { provide: MailerService, useValue: mailer },
      ],
    }).compile();
    service = module.get(BookingsService);
  });

  describe('create', () => {
    const dtoOk = {
      date: '2026-04-26',
      startTime: '14:00',
      duration: 60,
      name: 'V',
      email: 'v@x.com',
      phone: '0612345678',
      subject: 's',
      message: 'm',
    };

    it('insère un booking et retourne la row', async () => {
      // 1) check disabled : select.from.where.limit chain
      //    where() must return builder (for chaining to limit), limit() terminates
      db.where.mockReturnValueOnce(db);
      db.limit.mockResolvedValueOnce([]);
      // 2) check overlap : select.from.where chain, where() terminates with []
      db.where.mockResolvedValueOnce([]);
      // 3) insert.values.returning : returning returns [created]
      const created = mkBooking();
      db.returning.mockResolvedValueOnce([created]);
      const result = await service.create(dtoOk);
      expect(result).toEqual(created);
    });

    it('throw ConflictException si la date est dans disabled_date', async () => {
      // where() returns builder for chaining, limit() terminates with non-empty → throws
      db.where.mockReturnValueOnce(db);
      db.limit.mockResolvedValueOnce([{ id: 'disabled-id' }]);
      await expect(service.create(dtoOk)).rejects.toThrow(ConflictException);
      // L'insert ne doit pas être appelé
      expect(mailer.sendMail).not.toHaveBeenCalled();
    });

    it('throw ConflictException si un slot existant chevauche', async () => {
      // where() returns builder for chaining, limit() terminates with []
      db.where.mockReturnValueOnce(db);
      db.limit.mockResolvedValueOnce([]);
      // Booking existant 13:30-14:30 chevauche notre 14:00-15:00
      db.where.mockResolvedValueOnce([{ startTime: '13:30', duration: 60 }]);
      await expect(service.create(dtoOk)).rejects.toThrow(ConflictException);
      expect(mailer.sendMail).not.toHaveBeenCalled();
    });

    it('autorise un slot adjacent (pas de chevauchement)', async () => {
      // where() returns builder for chaining, limit() terminates with []
      db.where.mockReturnValueOnce(db);
      db.limit.mockResolvedValueOnce([]);
      // Booking existant 13:00-14:00, notre 14:00-15:00 → adjacent
      db.where.mockResolvedValueOnce([{ startTime: '13:00', duration: 60 }]);
      const created = mkBooking();
      db.returning.mockResolvedValueOnce([created]);
      const result = await service.create(dtoOk);
      expect(result).toEqual(created);
    });

    it('resolve quand même si MailerService.sendMail reject (fire-and-forget)', async () => {
      // where() returns builder for chaining, limit() terminates with []
      db.where.mockReturnValueOnce(db);
      db.limit.mockResolvedValueOnce([]);
      // sameDay check: where() terminates with []
      db.where.mockResolvedValueOnce([]);
      const created = mkBooking();
      db.returning.mockResolvedValueOnce([created]);
      mailer.sendMail.mockRejectedValue(new Error('SMTP down'));
      await expect(service.create(dtoOk)).resolves.toEqual(created);
    });
  });

  describe('findAll', () => {
    it('retourne le résultat paginé', async () => {
      const rows = [mkBooking({ id: 'a' }), mkBooking({ id: 'b' })];
      // findAll fait Promise.all([count, data])
      // 1) count chain : select.from terminator → from
      db.from.mockResolvedValueOnce([{ count: 42 }]);
      // 2) data chain : select.from.orderBy.limit.offset → offset
      db.offset.mockResolvedValueOnce(rows);
      const result = await service.findAll({
        page: 2,
        limit: 5,
        offset: 5,
      });
      expect(result).toEqual({
        data: rows,
        total: 42,
        page: 2,
        limit: 5,
      });
    });
  });

  describe('findSlotsByMonth', () => {
    it('filtre les bookings du mois fourni', async () => {
      const rows = [{ date: '2026-04-15', startTime: '10:00', duration: 30 }];
      db.where.mockResolvedValueOnce(rows);
      const result = await service.findSlotsByMonth('2026-04');
      expect(result).toEqual(rows);
    });

    it("gère la bordure d'année (décembre → janvier suivant)", async () => {
      db.where.mockResolvedValueOnce([]);
      const result = await service.findSlotsByMonth('2026-12');
      expect(result).toEqual([]);
      // Vérifier que `where` a été appelé (avec gte('2026-12-01') et lt('2027-01-01'))
      expect(db.where).toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('supprime sans erreur si trouvé', async () => {
      db.returning.mockResolvedValueOnce([{ id: 'an-id' }]);
      await expect(service.remove('an-id')).resolves.toBeUndefined();
    });

    it('throw NotFoundException si id absent', async () => {
      db.returning.mockResolvedValueOnce([]);
      await expect(service.remove('nope')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findAllDisabledDates', () => {
    it('retourne le tableau ordonné par date ASC', async () => {
      const rows = [mkDisabledDate({ id: 'a' })];
      db.orderBy.mockResolvedValueOnce(rows);
      await expect(service.findAllDisabledDates()).resolves.toEqual(rows);
    });
  });

  describe('createDisabledDate', () => {
    it('insère une disabled date avec reason', async () => {
      const created = mkDisabledDate({ reason: 'Vacation' });
      db.returning.mockResolvedValueOnce([created]);
      const result = await service.createDisabledDate({
        date: '2026-12-25',
        reason: 'Vacation',
      });
      expect(result).toEqual(created);
    });

    it('throw ConflictException sur unique violation (date déjà désactivée)', async () => {
      // Flat error (legacy / direct pg path)
      db.returning.mockRejectedValueOnce({
        code: '23505',
        constraint_name: 'disabled_date_date_unique',
      });
      await expect(
        service.createDisabledDate({ date: '2026-12-25' }),
      ).rejects.toThrow(ConflictException);
    });

    it('throw ConflictException quand Drizzle wrappe le PostgresError dans .cause', async () => {
      // Drizzle ≥0.36 wraps the raw pg error in a DrizzleQueryError whose
      // `.cause` holds the PostgresError (code '23505' + constraint_name).
      const wrappedErr = new Error('Failed query: INSERT INTO ...');
      (wrappedErr as unknown as Record<string, unknown>).cause = {
        code: '23505',
        constraint_name: 'disabled_date_date_unique',
      };
      db.returning.mockRejectedValueOnce(wrappedErr);
      await expect(
        service.createDisabledDate({ date: '2026-12-25' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('removeDisabledDate', () => {
    it('supprime sans erreur si trouvé', async () => {
      db.returning.mockResolvedValueOnce([{ id: 'an-id' }]);
      await expect(
        service.removeDisabledDate('an-id'),
      ).resolves.toBeUndefined();
    });

    it('throw NotFoundException si id absent', async () => {
      db.returning.mockResolvedValueOnce([]);
      await expect(service.removeDisabledDate('nope')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
