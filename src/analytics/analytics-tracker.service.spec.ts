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
        { url: '/' },
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

      await service.track({ url: '/projects' }, '1.2.3.4', NORMAL_UA);

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
        { url: '/projects', duration: 5 },
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

      await service.track({ url: '/home' }, '1.2.3.4', NORMAL_UA);

      expect(db.insert).toHaveBeenCalledTimes(1);
      expect(db.update).not.toHaveBeenCalled();
    });
  });

  describe('custom event', () => {
    it("eventType='project_click' → INSERT analytics_event, pas page_view", async () => {
      db.returning.mockResolvedValueOnce([{ id: 'ev' }]);

      await service.track(
        {
          url: '/projects/foo',
          eventType: 'project_click',
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
  });

  describe('UA parsing fallback', () => {
    it('UA inconnu → browser/os null', async () => {
      db.limit.mockResolvedValueOnce([]);
      db.returning.mockResolvedValueOnce([{ id: 'pv' }]);

      await service.track({ url: '/' }, '1.2.3.4', 'totally-unknown-ua');

      expect(db.values).toHaveBeenCalledWith(
        expect.objectContaining({
          browser: null,
          os: null,
        }),
      );
    });
  });

  describe('géoloc fallback', () => {
    it('IP locale → country null (pas crash)', async () => {
      geoipLookup.mockReturnValue(null);
      db.limit.mockResolvedValueOnce([]);
      db.returning.mockResolvedValueOnce([{ id: 'pv' }]);

      await service.track({ url: '/' }, '127.0.0.1', NORMAL_UA);

      expect(db.values).toHaveBeenCalledWith(
        expect.objectContaining({ country: null }),
      );
    });
  });

  describe('session hash', () => {
    it('même IP+UA+jour → même hash sur 2 calls', async () => {
      db.limit.mockResolvedValue([]);
      db.returning.mockResolvedValue([{ id: 'x' }]);

      await service.track({ url: '/a' }, '1.2.3.4', NORMAL_UA);
      const firstCall = db.values.mock.calls[0][0] as { sessionHash: string };

      await service.track({ url: '/b' }, '1.2.3.4', NORMAL_UA);
      const secondCall = db.values.mock.calls[1][0] as { sessionHash: string };

      expect(firstCall.sessionHash).toBe(secondCall.sessionHash);
      expect(firstCall.sessionHash).toHaveLength(64); // SHA256 hex = 64 chars
    });

    it('même IP+UA mais 2 jours différents → hash différent', async () => {
      db.limit.mockResolvedValue([]);
      db.returning.mockResolvedValue([{ id: 'x' }]);

      await service.track({ url: '/a' }, '1.2.3.4', NORMAL_UA);
      const day1Hash = (db.values.mock.calls[0][0] as { sessionHash: string })
        .sessionHash;

      jest.setSystemTime(new Date('2026-04-27T10:30:00Z')); // J+1
      await service.track({ url: '/a' }, '1.2.3.4', NORMAL_UA);
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
        service.track({ url: '/' }, '1.2.3.4', NORMAL_UA),
      ).resolves.toBeUndefined();
    });
  });
});
