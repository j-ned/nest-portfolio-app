/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Test, TestingModule } from '@nestjs/testing';
import { AnalyticsTrackerService } from './analytics-tracker.service';
import { DRIZZLE } from '../database/drizzle.constants';
import { createMockDb } from '../database/test-utils';
import * as isbotModule from 'isbot';
import * as geoipModule from 'geoip-lite';

jest.mock('isbot');
jest.mock('geoip-lite');

describe('AnalyticsTrackerService', () => {
  let service: AnalyticsTrackerService;
  let db: ReturnType<typeof createMockDb>;
  const isbotMock = isbotModule.isbot as unknown as jest.Mock;
  const geoipLookup = geoipModule.lookup as unknown as jest.Mock;

  const NORMAL_UA =
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  beforeEach(async () => {
    db = createMockDb();
    isbotMock.mockReturnValue(false);
    geoipLookup.mockReturnValue({ country: 'FR' });

    const module: TestingModule = await Test.createTestingModule({
      providers: [AnalyticsTrackerService, { provide: DRIZZLE, useValue: db }],
    }).compile();
    service = module.get(AnalyticsTrackerService);

    // Date fixe pour tester le hash
    jest.useFakeTimers().setSystemTime(new Date('2026-04-26T10:30:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe('bot filter', () => {
    it('skip silencieusement si UA est un bot', async () => {
      isbotMock.mockReturnValue(true);
      await service.track(
        { type: 'page_view', url: '/test' },
        '1.2.3.4',
        'Googlebot/2.1 (+http://www.google.com/bot.html)',
      );
      // Aucun appel DB
      expect(db.select).not.toHaveBeenCalled();
      expect(db.insert).not.toHaveBeenCalled();
    });
  });

  describe('page-view', () => {
    it("INSERT page_view si rien d'existant pour (session, url, jour)", async () => {
      db.limit.mockResolvedValueOnce([]); // pas de row existante
      db.returning.mockResolvedValueOnce([{ id: 'new-pv' }]);

      await service.track(
        { type: 'page_view', url: '/projects' },
        '1.2.3.4',
        NORMAL_UA,
      );

      expect(db.insert).toHaveBeenCalledTimes(1);
      expect(db.values).toHaveBeenCalledWith(
        expect.objectContaining({
          url: '/projects',
          country: 'FR',
        }),
      );
    });

    it('UPDATE duration si row existante (cumul)', async () => {
      db.limit.mockResolvedValueOnce([{ id: 'existing-pv', duration: 10 }]);
      db.returning.mockResolvedValueOnce([{ id: 'existing-pv' }]);

      await service.track(
        { type: 'page_duration', url: '/projects', duration: 5 },
        '1.2.3.4',
        NORMAL_UA,
      );

      expect(db.update).toHaveBeenCalledTimes(1);
      expect(db.set).toHaveBeenCalledWith(
        expect.objectContaining({ duration: 15 }), // 10 + 5
      );
      expect(db.insert).not.toHaveBeenCalled();
    });

    it('URL différente → 2e INSERT (pas UPDATE)', async () => {
      db.limit.mockResolvedValueOnce([]); // pas de match pour /home
      db.returning.mockResolvedValueOnce([{ id: 'pv' }]);

      await service.track(
        { type: 'page_view', url: '/home' },
        '1.2.3.4',
        NORMAL_UA,
      );

      expect(db.insert).toHaveBeenCalledTimes(1);
      expect(db.update).not.toHaveBeenCalled();
    });
  });

  describe('custom event', () => {
    it("type='project_click' → INSERT analytics_event, pas page_view", async () => {
      db.returning.mockResolvedValueOnce([{ id: 'ev' }]);

      await service.track(
        {
          type: 'project_click',
          entityId: 'foo-id',
          entityTitle: 'Foo Project',
          metadata: { source: 'card' },
        },
        '1.2.3.4',
        NORMAL_UA,
      );

      expect(db.insert).toHaveBeenCalledTimes(1);
      expect(db.values).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'project_click',
          entityId: 'foo-id',
          entityTitle: 'Foo Project',
          metadata: { source: 'card' },
        }),
      );
      // Pas de SELECT (page-view branch only)
      expect(db.select).not.toHaveBeenCalled();
    });

    it("type='cv_download' sans url → INSERT analytics_event (url optionnel pour custom event)", async () => {
      db.returning.mockResolvedValueOnce([{ id: 'ev-cv' }]);

      await service.track({ type: 'cv_download' }, '1.2.3.4', NORMAL_UA);

      expect(db.insert).toHaveBeenCalledTimes(1);
      expect(db.values).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'cv_download',
        }),
      );
      // Pas de SELECT (page-view branch only)
      expect(db.select).not.toHaveBeenCalled();
    });
  });

  describe('UA parsing fallback', () => {
    it('UA inconnu → browser/os null', async () => {
      db.limit.mockResolvedValueOnce([]);
      db.returning.mockResolvedValueOnce([{ id: 'pv' }]);

      await service.track(
        { type: 'page_view', url: '/test' },
        '1.2.3.4',
        'totally-unknown-ua',
      );

      expect(db.values).toHaveBeenCalledWith(
        expect.objectContaining({
          browser: null,
          os: null,
        }),
      );
    });
  });

  describe('géoloc fallback', () => {
    it('IP inconnue de geoip → country null (pas crash)', async () => {
      geoipLookup.mockReturnValue(null);
      db.limit.mockResolvedValueOnce([]);
      db.returning.mockResolvedValueOnce([{ id: 'pv' }]);

      await service.track(
        { type: 'page_view', url: '/test' },
        '198.51.100.42',
        NORMAL_UA,
      );

      expect(db.values).toHaveBeenCalledWith(
        expect.objectContaining({ country: null }),
      );
    });
  });

  describe('private IP filter', () => {
    it.each([
      // Loopback
      ['127.0.0.1', 'IPv4 loopback'],
      ['127.42.0.7', 'IPv4 loopback range 127/8'],
      ['::1', 'IPv6 loopback'],
      // IPv4-mapped IPv6
      ['::ffff:127.0.0.1', 'IPv4-mapped loopback'],
      ['::ffff:192.168.1.5', 'IPv4-mapped RFC1918'],
      ['::ffff:10.0.0.1', 'IPv4-mapped 10/8'],
      // RFC 1918
      ['10.0.0.1', '10/8'],
      ['10.255.255.254', '10/8 edge'],
      ['172.16.0.1', '172.16/12 lower bound'],
      ['172.20.5.5', '172.16/12 middle'],
      ['172.31.255.254', '172.16/12 upper bound'],
      ['192.168.0.1', '192.168/16'],
      ['192.168.1.42', '192.168/16'],
      // Link-local IPv4
      ['169.254.1.1', '169.254/16 IPv4 link-local'],
      // IPv6 link-local
      ['fe80::1', 'IPv6 link-local fe80'],
      ['febf::abcd', 'IPv6 link-local febf (upper bound)'],
      // IPv6 ULA
      ['fc00::1', 'IPv6 ULA fc00'],
      ['fd12:3456::1', 'IPv6 ULA fd'],
    ])('skip silencieusement si IP=%s (%s)', async (ip) => {
      await service.track({ type: 'page_view', url: '/test' }, ip, NORMAL_UA);
      expect(db.select).not.toHaveBeenCalled();
      expect(db.insert).not.toHaveBeenCalled();
    });

    it('skip aussi pour les custom events depuis IP privée', async () => {
      await service.track({ type: 'cv_download' }, '192.168.1.10', NORMAL_UA);
      expect(db.insert).not.toHaveBeenCalled();
    });

    it.each([
      ['8.8.8.8', 'Google DNS public'],
      ['1.1.1.1', 'Cloudflare public'],
      ['172.15.0.1', 'juste avant 172.16/12'],
      ['172.32.0.1', 'juste après 172.31'],
      ['169.253.1.1', 'juste avant 169.254/16'],
      ['192.169.1.1', 'juste après 192.168/16'],
      ['2606:4700:4700::1111', 'IPv6 public (Cloudflare)'],
    ])('IP publique %s (%s) → tracking normal', async (ip) => {
      db.limit.mockResolvedValueOnce([]);
      db.returning.mockResolvedValueOnce([{ id: 'pv' }]);
      await service.track({ type: 'page_view', url: '/test' }, ip, NORMAL_UA);
      expect(db.insert).toHaveBeenCalledTimes(1);
    });
  });

  describe('URL filter (login/admin)', () => {
    it.each([
      ['/login'],
      ['/admin'],
      ['/admin/'],
      ['/admin/users'],
      ['/admin/foo/bar'],
    ])('skip page_view pour url=%s', async (url) => {
      await service.track({ type: 'page_view', url }, '1.2.3.4', NORMAL_UA);
      expect(db.select).not.toHaveBeenCalled();
      expect(db.insert).not.toHaveBeenCalled();
    });

    it('skip page_duration sur /admin/*', async () => {
      await service.track(
        { type: 'page_duration', url: '/admin/dashboard', duration: 10 },
        '1.2.3.4',
        NORMAL_UA,
      );
      expect(db.select).not.toHaveBeenCalled();
      expect(db.update).not.toHaveBeenCalled();
      expect(db.insert).not.toHaveBeenCalled();
    });

    it('ne filtre PAS une url qui commence par /login… mais pas /login (ex: /logins)', async () => {
      db.limit.mockResolvedValueOnce([]);
      db.returning.mockResolvedValueOnce([{ id: 'pv' }]);
      await service.track(
        { type: 'page_view', url: '/logins' },
        '1.2.3.4',
        NORMAL_UA,
      );
      expect(db.insert).toHaveBeenCalledTimes(1);
    });

    it('ne filtre PAS /admin-public (préfixe seul ne suffit pas)', async () => {
      db.limit.mockResolvedValueOnce([]);
      db.returning.mockResolvedValueOnce([{ id: 'pv' }]);
      await service.track(
        { type: 'page_view', url: '/admin-public' },
        '1.2.3.4',
        NORMAL_UA,
      );
      expect(db.insert).toHaveBeenCalledTimes(1);
    });

    it('les custom events ne sont PAS filtrés par URL (pas de url chez eux)', async () => {
      db.returning.mockResolvedValueOnce([{ id: 'ev' }]);
      await service.track(
        { type: 'project_click', entityId: 'x' },
        '1.2.3.4',
        NORMAL_UA,
      );
      expect(db.insert).toHaveBeenCalledTimes(1);
    });
  });

  describe('session hash', () => {
    it('même IP+UA+jour → même hash sur 2 calls', async () => {
      db.limit.mockResolvedValue([]);
      db.returning.mockResolvedValue([{ id: 'x' }]);

      await service.track(
        { type: 'page_view', url: '/a' },
        '1.2.3.4',
        NORMAL_UA,
      );
      const firstCall = db.values.mock.calls[0][0] as { sessionHash: string };

      await service.track(
        { type: 'page_view', url: '/b' },
        '1.2.3.4',
        NORMAL_UA,
      );
      const secondCall = db.values.mock.calls[1][0] as { sessionHash: string };

      expect(firstCall.sessionHash).toBe(secondCall.sessionHash);
      expect(firstCall.sessionHash).toHaveLength(64); // SHA256 hex = 64 chars
    });

    it('même IP+UA mais 2 jours différents → hash différent', async () => {
      db.limit.mockResolvedValue([]);
      db.returning.mockResolvedValue([{ id: 'x' }]);

      await service.track(
        { type: 'page_view', url: '/a' },
        '1.2.3.4',
        NORMAL_UA,
      );
      const day1Hash = (db.values.mock.calls[0][0] as { sessionHash: string })
        .sessionHash;

      jest.setSystemTime(new Date('2026-04-27T10:30:00Z')); // J+1
      await service.track(
        { type: 'page_view', url: '/a' },
        '1.2.3.4',
        NORMAL_UA,
      );
      const day2Hash = (db.values.mock.calls[1][0] as { sessionHash: string })
        .sessionHash;

      expect(day1Hash).not.toBe(day2Hash);
    });
  });

  describe('error swallowing', () => {
    it('erreur DB pendant INSERT → ne propage pas (track ne throw jamais)', async () => {
      db.limit.mockResolvedValueOnce([]);
      db.returning.mockRejectedValueOnce(new Error('DB down'));

      // Ne doit PAS rejeter
      await expect(
        service.track(
          { type: 'page_view', url: '/test' },
          '1.2.3.4',
          NORMAL_UA,
        ),
      ).resolves.toBeUndefined();
    });
  });
});
