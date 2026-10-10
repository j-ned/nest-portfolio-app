import { type SessionFacts, summarizeSessions } from './session-facts';

const THRESHOLD = 30;

const visit = (overrides: Partial<SessionFacts> = {}): SessionFacts => ({
  pages: 1,
  durationSum: null,
  durationSamples: 0,
  engaged: false,
  ...overrides,
});

describe('summarizeSessions', () => {
  it.each([
    ['1 page, aucun événement, 12 s', 1, 1, visit({ durationSum: 12 })],
    ['1 page, aucun événement, 45 s', 1, 0, visit({ durationSum: 45 })],
    [
      '1 page, un événement, 3 s',
      1,
      0,
      visit({ durationSum: 3, engaged: true }),
    ],
    ['2 pages, aucun événement, sans durée', 0, 0, visit({ pages: 2 })],
    ['1 page, durée inconnue', 1, 1, visit({ durationSum: null })],
    ['1 page, seuil exact 30 s', 1, 0, visit({ durationSum: 30 })],
    ['1 page, 29 s', 1, 1, visit({ durationSum: 29 })],
  ])(
    'Given a visit (%s), When summarized, Then bounces=%i and realBounces=%i',
    (_label, bounces, realBounces, facts) => {
      const summary = summarizeSessions([facts], THRESHOLD);

      expect(summary).toMatchObject({
        sessions: 1,
        bounces,
        realBounces,
        engagedSessions: 1 - realBounces,
      });
    },
  );

  it('Given several visits, When summarized, Then pages, durations and samples are summed', () => {
    const summary = summarizeSessions(
      [
        visit({ durationSum: 12, durationSamples: 1 }),
        visit({ engaged: true }),
        visit({ pages: 3, durationSum: 100, durationSamples: 2 }),
      ],
      THRESHOLD,
    );

    expect(summary).toEqual({
      sessions: 3,
      pageviews: 5,
      bounces: 2,
      realBounces: 1,
      engagedSessions: 2,
      totalDuration: 112,
      durationSamples: 3,
    });
  });

  it('Given the threshold, When it changes, Then the same visit switches class', () => {
    const facts = [visit({ durationSum: 20 })];

    expect(summarizeSessions(facts, 10).realBounces).toBe(0);
    expect(summarizeSessions(facts, 30).realBounces).toBe(1);
  });

  it('Given no visit, When summarized, Then every counter is zero', () => {
    expect(summarizeSessions([], THRESHOLD)).toEqual({
      sessions: 0,
      pageviews: 0,
      bounces: 0,
      realBounces: 0,
      engagedSessions: 0,
      totalDuration: 0,
      durationSamples: 0,
    });
  });
});
