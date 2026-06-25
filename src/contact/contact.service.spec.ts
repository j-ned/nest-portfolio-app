/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ContactService } from './contact.service';
import { DRIZZLE } from '../database/drizzle.constants';
import { createMockDb } from '../database/test-utils';
import { MailerService } from '../mailer/mailer.service';
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
      ],
    }).compile();
    service = module.get(ContactService);
  });

  describe('create', () => {
    it('insère un message et retourne la row', async () => {
      const created = mkMessage();
      db.returning.mockResolvedValueOnce([created]);
      const result = await service.create({
        name: 'Visitor',
        email: 'visitor@example.com',
        subject: 'Hello',
        message: 'Hi there!',
      });
      expect(result).toEqual(created);
    });

    it('retourne immédiatement, sans attendre les mails', async () => {
      const created = mkMessage();
      db.returning.mockResolvedValueOnce([created]);
      // Mailer met 100ms à répondre
      mailer.sendMail.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 100)),
      );
      const start = Date.now();
      await service.create({
        name: 'V',
        email: 'v@x.com',
        subject: 's',
        message: 'm',
      });
      const elapsed = Date.now() - start;
      // Le `create` doit retourner bien avant les 100ms × 2 mails
      expect(elapsed).toBeLessThan(50);
    });

    it('appelle MailerService.sendMail 2 fois (admin + visitor)', async () => {
      const created = mkMessage();
      db.returning.mockResolvedValueOnce([created]);
      await service.create({
        name: 'V',
        email: 'v@x.com',
        subject: 's',
        message: 'm',
      });
      // Attendre que les promises fire-and-forget se résolvent
      await new Promise((resolve) => setImmediate(resolve));
      expect(mailer.sendMail).toHaveBeenCalledTimes(2);
    });

    it('envoie le mail admin au destinataire fixe avec sujet "Nouveau message de contact: <subject>"', async () => {
      const created = mkMessage({ subject: 'Demande de devis' });
      db.returning.mockResolvedValueOnce([created]);
      await service.create({
        name: 'V',
        email: 'v@x.com',
        subject: 'Demande de devis',
        message: 'm',
      });
      await new Promise((resolve) => setImmediate(resolve));
      const adminCall = mailer.sendMail.mock.calls.find(
        (call) => call[0].to === 'contact@nedellec-julien.fr',
      );
      expect(adminCall).toBeDefined();
      expect(adminCall![0].subject).toBe(
        'Nouveau message de contact: Demande de devis',
      );
      expect(adminCall![0].html).toContain('Demande de devis');
    });

    it('envoie le mail confirmation à dto.email avec sujet "Confirmation de votre message"', async () => {
      const created = mkMessage({ email: 'visitor@example.com' });
      db.returning.mockResolvedValueOnce([created]);
      await service.create({
        name: 'V',
        email: 'visitor@example.com',
        subject: 's',
        message: 'm',
      });
      await new Promise((resolve) => setImmediate(resolve));
      const visitorCall = mailer.sendMail.mock.calls.find(
        (call) => call[0].to === 'visitor@example.com',
      );
      expect(visitorCall).toBeDefined();
      expect(visitorCall![0].subject).toBe('Confirmation de votre message');
    });

    it('resolve quand même si MailerService.sendMail reject (fire-and-forget)', async () => {
      const created = mkMessage();
      db.returning.mockResolvedValueOnce([created]);
      mailer.sendMail.mockRejectedValue(new Error('SMTP down'));
      // Le create ne doit pas throw même si les mails échouent
      await expect(
        service.create({
          name: 'V',
          email: 'v@x.com',
          subject: 's',
          message: 'm',
        }),
      ).resolves.toEqual(created);
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
