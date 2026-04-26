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
});
