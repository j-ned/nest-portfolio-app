import { computeAggregates } from './analytics-aggregates';
import { createMockDb } from '../database/test-utils';
import type { Database } from '../database/drizzle.types';

const START = new Date('2026-10-09T00:00:00.000Z');
const END = new Date('2026-10-09T23:59:59.999Z');

/** Une ligne par visite, comme la rend `loadSessionFacts`. */
const FACT_ROWS = [
  { pages: 1, duration_sum: 12, duration_samples: 1, engaged: false },
  { pages: 1, duration_sum: null, duration_samples: 0, engaged: true },
  { pages: 3, duration_sum: 100, duration_samples: 2, engaged: false },
];

const EVENT_ROW = {
  projectClicks: 4,
  articleViews: 3,
  cvDownloads: 2,
  ctaClicks: 5,
  contactSubmits: 1,
  contactClicks: 2,
  profileClicks: 0,
  demoClicks: 6,
  contactSectionViews: 7,
};

describe('computeAggregates', () => {
  let db: ReturnType<typeof createMockDb>;

  /** Ordre des requêtes : faits par visite, compteurs d'événements, conversions déjà vues. */
  const mockDay = (conversionsSeen: boolean) => {
    db.execute
      .mockResolvedValueOnce(FACT_ROWS)
      .mockResolvedValueOnce([{ measured: conversionsSeen }]);
    db.where.mockResolvedValueOnce([EVENT_ROW]);
  };

  beforeEach(() => {
    db = createMockDb();
  });

  it('Given three visits, When aggregated, Then visits, real bounces and measured durations come from summarizeSessions', async () => {
    mockDay(true);

    const day = await computeAggregates(db as unknown as Database, START, END);

    expect(day).toMatchObject({
      visitors: 3,
      sessions: 3,
      pageviews: 5,
      bounces: 2,
      realBounces: 1,
      engagedSessions: 2,
      totalDuration: 112,
      durationSamples: 3,
      projectClicks: 4,
      articleViews: 3,
      cvDownloads: 2,
      ctaClicks: 5,
    });
  });

  it('Given no v2 event was ever seen, When aggregated, Then the conversion columns are NULL (non mesuré)', async () => {
    mockDay(false);

    const day = await computeAggregates(db as unknown as Database, START, END);

    expect(day).toMatchObject({
      contactSubmits: null,
      contactClicks: null,
      profileClicks: null,
      demoClicks: null,
      contactSectionViews: null,
    });
  });

  it('Given a v2 event was seen this day or before, When aggregated, Then conversions are counted and a zero is a real zero', async () => {
    mockDay(true);

    const day = await computeAggregates(db as unknown as Database, START, END);

    expect(day).toMatchObject({
      contactSubmits: 1,
      contactClicks: 2,
      profileClicks: 0,
      demoClicks: 6,
      contactSectionViews: 7,
    });
  });

  it('Given an empty day, When aggregated, Then counters are zero and engagement is measured (0 visite)', async () => {
    db.execute
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ measured: false }]);
    db.where.mockResolvedValueOnce([{}]);

    const day = await computeAggregates(db as unknown as Database, START, END);

    expect(day).toMatchObject({
      sessions: 0,
      pageviews: 0,
      engagedSessions: 0,
      realBounces: 0,
      durationSamples: 0,
      projectClicks: 0,
    });
  });
});
