import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { createTransport } from 'nodemailer';
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

  describe('message MIME réellement composé', () => {
    type MimePart = { headers: Record<string, string>; body: string };

    const parseEntity = (entity: string): MimePart[] => {
      const separator = entity.indexOf('\r\n\r\n');
      const head = entity.slice(0, separator).replace(/\r\n[ \t]+/g, ' ');
      const body = entity.slice(separator + 4);
      const headers = Object.fromEntries(
        head.split('\r\n').map((line) => {
          const colon = line.indexOf(':');
          return [
            line.slice(0, colon).trim().toLowerCase(),
            line.slice(colon + 1).trim(),
          ];
        }),
      );
      const contentType = headers['content-type'] ?? 'text/plain';
      const boundary = /boundary="?([^";]+)"?/i.exec(contentType)?.[1];
      if (!/^multipart\//i.test(contentType) || !boundary) {
        return [{ headers, body }];
      }
      return body
        .split(`--${boundary}`)
        .slice(1, -1)
        .map((chunk) => chunk.replace(/^\r\n/, '').replace(/\r\n$/, ''))
        .flatMap(parseEntity);
    };

    const decode = ({ headers, body }: MimePart): string => {
      const encoding = (
        headers['content-transfer-encoding'] ?? '7bit'
      ).toLowerCase();
      if (encoding === 'base64') {
        return Buffer.from(body.replace(/\s/g, ''), 'base64').toString('utf8');
      }
      if (encoding === 'quoted-printable') {
        const bytes = body
          .replace(/=\r\n/g, '')
          .replace(/=([0-9A-F]{2})/gi, (_match, hex: string) =>
            String.fromCharCode(parseInt(hex, 16)),
          );
        return Buffer.from(bytes, 'latin1').toString('utf8');
      }
      return body;
    };

    const isCalendar = (part: MimePart): boolean =>
      /^(text\/calendar|application\/ics)\b/i.test(
        part.headers['content-type'] ?? '',
      );

    const icsOf = (method: string): string =>
      [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        `METHOD:${method}`,
        'BEGIN:VEVENT',
        'UID:dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        'SUMMARY:Appel de cadrage · 30 min',
        'END:VEVENT',
        'END:VCALENDAR',
        '',
      ].join('\r\n');

    const composedParts = async (
      icalEvent?: Parameters<MailerService['sendMail']>[0]['icalEvent'],
    ): Promise<MimePart[]> => {
      const stream = createTransport({ streamTransport: true, buffer: true });
      const sendMail = jest.spyOn(stream, 'sendMail');
      const module = await Test.createTestingModule({
        providers: [
          MailerService,
          { provide: MAIL_TRANSPORTER, useValue: stream },
          { provide: AppConfigService, useValue: cfg },
        ],
      }).compile();

      await module.get(MailerService).sendMail({
        to: 'visitor@example.com',
        subject: 'Rendez-vous',
        html: '<p>rdv</p>',
        ...(icalEvent && { icalEvent }),
      });

      const info = (await sendMail.mock.results[0].value) as {
        message: Buffer;
      };
      return parseEntity(info.message.toString('utf8'));
    };

    it.each(['REQUEST', 'PUBLISH', 'CANCEL'] as const)(
      'Given une invitation %s, When le mail part, Then le message ne contient qu’une seule partie calendrier',
      async (method) => {
        const parts = await composedParts({ method, content: icsOf(method) });

        expect(parts.filter(isCalendar)).toHaveLength(1);
      },
    );

    it.each(['REQUEST', 'PUBLISH', 'CANCEL'] as const)(
      'Given une invitation %s, When le mail part, Then la partie calendrier est text/calendar en UTF-8 avec la méthode et le contenu intact',
      async (method) => {
        const content = icsOf(method);

        const [calendar] = (await composedParts({ method, content })).filter(
          isCalendar,
        );

        const contentType = calendar.headers['content-type'];
        expect(contentType).toMatch(/^text\/calendar\s*;/i);
        expect(contentType).toMatch(/;\s*method="?([A-Z]+)"?/i);
        expect(/;\s*method="?([A-Z]+)"?/i.exec(contentType)?.[1]).toBe(method);
        expect(contentType).toMatch(/;\s*charset="?utf-8"?/i);
        expect(decode(calendar).replace(/\r\n/g, '\n')).toBe(
          content.replace(/\r\n/g, '\n'),
        );
      },
    );

    it('Given une invitation, When le mail part, Then le corps HTML reste une seule partie text/html', async () => {
      const parts = await composedParts({
        method: 'REQUEST',
        content: icsOf('REQUEST'),
      });

      const html = parts.filter((part) =>
        /^text\/html\b/i.test(part.headers['content-type'] ?? ''),
      );
      expect(html).toHaveLength(1);
      expect(decode(html[0])).toBe('<p>rdv</p>');
    });

    it('Given un mail sans invitation, When il part, Then aucune partie calendrier', async () => {
      const parts = await composedParts();

      expect(parts.filter(isCalendar)).toEqual([]);
    });
  });
});
