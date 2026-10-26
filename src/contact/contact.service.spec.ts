/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ContactService } from './contact.service';
import { DRIZZLE } from '../database/drizzle.constants';
import { createMockDb } from '../database/test-utils';
import { MailerService } from '../mailer/mailer.service';
import { AppConfigService } from '../config/app-config.service';
import { contactMessages, type ContactMessage } from '../database/schema';

describe('ContactService', () => {
  let service: ContactService;
  let db: ReturnType<typeof createMockDb>;
  let mailer: jest.Mocked<MailerService>;

  const mkMessage = (
    overrides: Partial<ContactMessage> = {},
  ): ContactMessage => ({
    id: '11111111-1111-1111-1111-111111111111',
    name: 'Visitor',
    email: 'visitor@example.com',
    subject: 'Hello',
    message: 'Hi there!',
    read: false,
    senderHash: null,
    userAgent: null,
    createdAt: new Date('2026-04-26T00:00:00Z'),
    ...overrides,
  });

  beforeEach(async () => {
    db = createMockDb();
    mailer = {
      sendMail: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<MailerService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContactService,
        { provide: DRIZZLE, useValue: db },
        { provide: MailerService, useValue: mailer },
        {
          provide: AppConfigService,
          useValue: { jwtSecret: 'test-jwt-secret' },
        },
      ],
    }).compile();
    service = module.get(ContactService);
  });

  describe('create', () => {
    const DTO = {
      name: 'Visitor',
      email: 'visitor@example.com',
      subject: 'Hello',
      message: 'Hi there!',
    };
    const SENDER = { ip: '203.0.113.7', userAgent: 'Mozilla/5.0 Test' };
    const flushMails = () => new Promise((resolve) => setImmediate(resolve));
    const insertedRows = () =>
      (db.values.mock.calls as [Record<string, unknown>][]).map(
        ([values]) => values,
      );
    const insertedValues = () => insertedRows()[0];

    it('Given un message valide, When il est créé, Then il est inséré sans rien renvoyer au visiteur', async () => {
      db.returning.mockResolvedValueOnce([mkMessage()]);
      await expect(service.create(DTO, SENDER)).resolves.toBeUndefined();
      expect(db.insert).toHaveBeenCalledWith(contactMessages);
    });

    it('Given un message, When il est inséré, Then il porte une empreinte HMAC de l’IP et le user-agent, jamais l’IP en clair', async () => {
      db.returning.mockResolvedValueOnce([mkMessage()]);
      await service.create(DTO, SENDER);
      const values = insertedValues();
      expect(values.senderHash).toMatch(/^[0-9a-f]{64}$/);
      expect(values.userAgent).toBe('Mozilla/5.0 Test');
      expect(JSON.stringify(values)).not.toContain('203.0.113.7');
    });

    it('Given deux messages de la même IP à des jours différents, When ils sont insérés, Then ils ont la même empreinte', async () => {
      db.returning.mockResolvedValue([mkMessage()]);
      await service.create(DTO, SENDER);
      await service.create(DTO, { ...SENDER, userAgent: 'Autre navigateur' });
      await service.create(DTO, { ...SENDER, ip: '198.51.100.1' });
      const [a, b, c] = insertedRows().map((values) => values.senderHash);
      expect(a).toBe(b);
      expect(a).not.toBe(c);
    });

    it('Given un secret différent, When l’empreinte est calculée, Then elle change (clé, pas un SHA-256 brut)', async () => {
      db.returning.mockResolvedValue([mkMessage()]);
      await service.create(DTO, SENDER);
      const other = await Test.createTestingModule({
        providers: [
          ContactService,
          { provide: DRIZZLE, useValue: db },
          { provide: MailerService, useValue: mailer },
          {
            provide: AppConfigService,
            useValue: { jwtSecret: 'un-autre-secret' },
          },
        ],
      }).compile();
      await other.get(ContactService).create(DTO, SENDER);
      const [a, b] = insertedRows().map((values) => values.senderHash);
      expect(a).not.toBe(b);
    });

    it('Given un user-agent démesuré ou absent, When il est stocké, Then il est tronqué à 300 caractères ou null', async () => {
      db.returning.mockResolvedValue([mkMessage()]);
      await service.create(DTO, { ...SENDER, userAgent: 'x'.repeat(1000) });
      await service.create(DTO, { ...SENDER, userAgent: '' });
      const [long, empty] = insertedRows().map((values) => values.userAgent);
      expect(long).toHaveLength(300);
      expect(empty).toBeNull();
    });

    it('Given le champ piège rempli, When le message arrive, Then rien n’est inséré ni envoyé', async () => {
      await expect(
        service.create({ ...DTO, website: 'https://spam.test' }, SENDER),
      ).resolves.toBeUndefined();
      await flushMails();
      expect(db.insert).not.toHaveBeenCalled();
      expect(mailer.sendMail).not.toHaveBeenCalled();
    });

    it('Given le champ piège vide, When le message arrive, Then il est traité normalement', async () => {
      db.returning.mockResolvedValueOnce([mkMessage()]);
      await service.create({ ...DTO, website: '' }, SENDER);
      expect(db.insert).toHaveBeenCalledWith(contactMessages);
      expect(insertedValues()).not.toHaveProperty('website');
    });

    it('retourne immédiatement, sans attendre le mail', async () => {
      db.returning.mockResolvedValueOnce([mkMessage()]);
      mailer.sendMail.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 100)),
      );
      const start = Date.now();
      await service.create(DTO, SENDER);
      expect(Date.now() - start).toBeLessThan(50);
    });

    it('Given un message, When il est créé, Then un seul mail part, vers le propriétaire, jamais vers l’adresse saisie', async () => {
      db.returning.mockResolvedValueOnce([
        mkMessage({ subject: 'Demande de devis' }),
      ]);
      await service.create({ ...DTO, subject: 'Demande de devis' }, SENDER);
      await flushMails();
      expect(mailer.sendMail).toHaveBeenCalledTimes(1);
      const [mail] = mailer.sendMail.mock.calls[0];
      expect(mail.to).toBe('contact@nedellec-julien.fr');
      expect(mail.subject).toBe('Nouveau message de contact: Demande de devis');
      expect(mail.html).toContain('Demande de devis');
    });

    it('resolve quand même si MailerService.sendMail reject (fire-and-forget)', async () => {
      db.returning.mockResolvedValueOnce([mkMessage()]);
      mailer.sendMail.mockRejectedValue(new Error('SMTP down'));
      await expect(service.create(DTO, SENDER)).resolves.toBeUndefined();
    });
  });

  describe('findAll', () => {
    it('retourne le résultat paginé { data, total, page, limit }', async () => {
      const rows = [mkMessage({ id: 'a' }), mkMessage({ id: 'b' })];
      // findAll fait 2 queries en parallèle (Promise.all, ordre dans le tableau) :
      // 1) select(count).from → totalRow (terminator: from)
      // 2) select.from.orderBy.limit.offset → rows (terminator: offset)
      // mockResolvedValueOnce sur chaque terminator dans l'ordre d'exécution.
      db.offset.mockResolvedValueOnce(rows);
      db.from.mockResolvedValueOnce([{ count: 42 }]);
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

  describe('unreadCount', () => {
    it('retourne { count } filtré sur read: false', async () => {
      db.where.mockResolvedValueOnce([{ count: 7 }]);
      const result = await service.unreadCount();
      expect(result).toEqual({ count: 7 });
    });

    it('retourne count: 0 si aucun row', async () => {
      db.where.mockResolvedValueOnce([]);
      const result = await service.unreadCount();
      expect(result).toEqual({ count: 0 });
    });
  });

  describe('markRead', () => {
    it('met read: true et retourne la row', async () => {
      const updated = mkMessage({ read: true });
      db.returning.mockResolvedValueOnce([updated]);
      const result = await service.markRead(updated.id);
      expect(result.read).toBe(true);
    });

    it('throw NotFoundException si id absent', async () => {
      db.returning.mockResolvedValueOnce([]);
      await expect(service.markRead('nope')).rejects.toThrow(NotFoundException);
    });
  });

  describe('markAllRead', () => {
    it('retourne { count: N } = nb de lignes passées de non-lu à lu', async () => {
      // Given : 3 messages non-lus en base (terminator .returning → rows affectées)
      db.returning.mockResolvedValueOnce([
        { id: 'a' },
        { id: 'b' },
        { id: 'c' },
      ]);
      // When
      const result = await service.markAllRead();
      // Then
      expect(result).toEqual({ count: 3 });
    });

    it('retourne { count: 0 } quand aucun message non-lu', async () => {
      // Given : aucune ligne affectée
      db.returning.mockResolvedValueOnce([]);
      // When
      const result = await service.markAllRead();
      // Then
      expect(result).toEqual({ count: 0 });
    });

    it('mute read: true (set) et cible la table contactMessages (update)', async () => {
      // Given
      db.returning.mockResolvedValueOnce([{ id: 'a' }]);
      // When
      await service.markAllRead();
      // Then : intention de mutation et de table
      expect(db.update).toHaveBeenCalledWith(contactMessages);
      expect(db.set).toHaveBeenCalledWith({ read: true });
    });
  });

  describe('remove', () => {
    it('supprime la row sans erreur si trouvée', async () => {
      db.returning.mockResolvedValueOnce([{ id: 'an-id' }]);
      await expect(service.remove('an-id')).resolves.toBeUndefined();
    });

    it('throw NotFoundException si id absent', async () => {
      db.returning.mockResolvedValueOnce([]);
      await expect(service.remove('nope')).rejects.toThrow(NotFoundException);
    });
  });
});
