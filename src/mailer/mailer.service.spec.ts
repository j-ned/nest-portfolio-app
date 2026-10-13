import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { MailerService } from './mailer.service';
import { MAIL_TRANSPORTER } from './mailer.constants';
import { AppConfigService } from '../config/app-config.service';

describe('MailerService', () => {
  let service: MailerService;
  let transporter: { sendMail: jest.Mock };
  let cfg: { smtpFrom: string };

  beforeEach(async () => {
    transporter = { sendMail: jest.fn() };
    cfg = { smtpFrom: 'noreply@test.local' };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MailerService,
        {
          provide: MAIL_TRANSPORTER,
          useValue: transporter,
        },
        {
          provide: AppConfigService,
          useValue: cfg,
        },
      ],
    }).compile();
    service = module.get(MailerService);
  });

  it('envoie le mail avec les bons paramètres', async () => {
    transporter.sendMail.mockResolvedValueOnce({});
    await service.sendMail({
      to: 'visitor@example.com',
      subject: 'Hello',
      html: '<p>hi</p>',
    });
    expect(transporter.sendMail).toHaveBeenCalledTimes(1);
    expect(transporter.sendMail).toHaveBeenCalledWith({
      from: 'noreply@test.local',
      to: 'visitor@example.com',
      subject: 'Hello',
      html: '<p>hi</p>',
    });
  });

  it.each(['REQUEST', 'CANCEL'] as const)(
    'Given une invitation %s, When le mail part, Then nodemailer reçoit icalEvent avec la méthode, le contenu et le nom invitation.ics',
    async (method) => {
      transporter.sendMail.mockResolvedValueOnce({});
      const content = `BEGIN:VCALENDAR\r\nMETHOD:${method}\r\nEND:VCALENDAR\r\n`;

      await service.sendMail({
        to: 'visitor@example.com',
        subject: 'Rendez-vous',
        html: '<p>rdv</p>',
        icalEvent: { method, content },
      });

      expect(transporter.sendMail).toHaveBeenCalledWith({
        from: 'noreply@test.local',
        to: 'visitor@example.com',
        subject: 'Rendez-vous',
        html: '<p>rdv</p>',
        icalEvent: { method, content, filename: 'invitation.ics' },
      });
    },
  );

  it('utilise cfg.smtpFrom comme expéditeur', async () => {
    transporter.sendMail.mockResolvedValueOnce({});
    await service.sendMail({ to: 'x@y.com', subject: 's', html: 'h' });
    expect(transporter.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'noreply@test.local' }),
    );
  });

  it('retry une fois si la première tentative échoue, puis succès', async () => {
    transporter.sendMail
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce({});
    jest.useFakeTimers();
    const promise = service.sendMail({
      to: 'x@y.com',
      subject: 's',
      html: 'h',
    });
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(1000);
    await promise;
    jest.useRealTimers();
    expect(transporter.sendMail).toHaveBeenCalledTimes(2);
  });

  it('throw après 3 tentatives échouées', async () => {
    const err = new Error('persistent');
    transporter.sendMail.mockRejectedValue(err);
    jest.useFakeTimers();
    const promise = service.sendMail({
      to: 'x@y.com',
      subject: 's',
      html: 'h',
    });
    // Attach catch early to prevent unhandled rejection warnings in Node 24 / Jest 30
    const caught = promise.catch((e: unknown) => e);
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(1000);
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(2000);
    await Promise.resolve();
    const result = await caught;
    jest.useRealTimers();
    expect(result).toBe(err);
    expect(transporter.sendMail).toHaveBeenCalledTimes(3);
  });

  it('ne retry pas si la première tentative réussit', async () => {
    transporter.sendMail.mockResolvedValueOnce({});
    await service.sendMail({ to: 'x@y.com', subject: 's', html: 'h' });
    expect(transporter.sendMail).toHaveBeenCalledTimes(1);
  });

  it('passe le sujet et le HTML tels quels (pas de transformation)', async () => {
    transporter.sendMail.mockResolvedValueOnce({});
    const html = '<html><body><h1>Hello {{name}}</h1></body></html>';
    await service.sendMail({
      to: 'x@y.com',
      subject: 'Sujet avec accents éàç',
      html,
    });
    expect(transporter.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: 'Sujet avec accents éàç',
        html,
      }),
    );
  });

  it('Given trois échecs, When l’erreur est journalisée, Then l’adresse du destinataire est masquée, message et trace compris', async () => {
    const errorLog = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    transporter.sendMail.mockRejectedValue(
      new Error('550 5.1.1 <camille@example.com>: Recipient address rejected'),
    );
    jest.useFakeTimers();
    const caught = service
      .sendMail({ to: 'camille@example.com', subject: 's', html: 'h' })
      .catch((e: unknown) => e);
    await jest.advanceTimersByTimeAsync(3000);
    await caught;
    jest.useRealTimers();

    const logged = JSON.stringify(errorLog.mock.calls);
    expect(logged).not.toContain('camille@example.com');
    expect(logged).toContain('c***@example.com');
    errorLog.mockRestore();
  });
});
