import { ConfigService } from '@nestjs/config';
import { AppConfigService } from './app-config.service';
import type { Env } from './env.schema';

describe('AppConfigService', () => {
  it('Given BOOKING_VIDEO_URL_BASE, When le getter est lu, Then la base des salles de visio', () => {
    const config = new AppConfigService(
      new ConfigService<Env, true>({
        BOOKING_VIDEO_URL_BASE: 'https://visio.example.test',
      }),
    );

    expect(config.bookingVideoUrlBase).toBe('https://visio.example.test');
  });

  it('Given PUBLIC_SITE_URL, When le getter est lu, Then l’origine publique du site', () => {
    const config = new AppConfigService(
      new ConfigService<Env, true>({
        PUBLIC_SITE_URL: 'https://site.example.test',
      }),
    );

    expect(config.publicSiteUrl).toBe('https://site.example.test');
  });
});
