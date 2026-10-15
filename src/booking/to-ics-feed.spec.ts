import { type IcsFeed, type IcsFeedEvent, toIcsFeed } from './to-ics';

const anIcsFeedEvent = (
  overrides: Partial<IcsFeedEvent> = {},
): IcsFeedEvent => ({
  uid: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  stamp: new Date('2026-11-02T08:00:00Z'),
  startsAt: new Date('2026-11-04T10:00:00Z'),
  endsAt: new Date('2026-11-04T10:30:00Z'),
  summary: 'Appel de cadrage · Marie Dupont',
  description: 'Appel de cadrage de 30 minutes avec Marie Dupont.',
  location: 'https://meet.jit.si/nedellec-abcdefgh12345678',
  ...overrides,
});

const anIcsFeed = (overrides: Partial<IcsFeed> = {}): IcsFeed => ({
  name: 'Rendez-vous nedellec-julien.fr',
  refreshMinutes: 15,
  events: [anIcsFeedEvent()],
  ...overrides,
});

const unfold = (ics: string): string => ics.replace(/\r\n[ \t]/g, '');
const contentLines = (ics: string): string[] =>
  unfold(ics)
    .split('\r\n')
    .filter((line) => line !== '');
const physicalLines = (ics: string): string[] =>
  ics.split('\r\n').filter((line) => line !== '');
const bytes = (line: string): number => Buffer.byteLength(line, 'utf8');
const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

const ENVELOPE_HEAD = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//nedellec-julien.fr//Booking//FR',
  'CALSCALE:GREGORIAN',
  'NAME:Rendez-vous nedellec-julien.fr',
  'X-WR-CALNAME:Rendez-vous nedellec-julien.fr',
  'REFRESH-INTERVAL;VALUE=DURATION:PT15M',
  'X-PUBLISHED-TTL:PT15M',
];

describe('toIcsFeed', () => {
  it('Given un événement, Then un calendrier publié dont chaque ligne est celle du contrat', () => {
    expect(contentLines(toIcsFeed(anIcsFeed()))).toEqual([
      ...ENVELOPE_HEAD,
      'BEGIN:VEVENT',
      'UID:dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      'SEQUENCE:0',
      'STATUS:CONFIRMED',
      'DTSTAMP:20261102T080000Z',
      'DTSTART:20261104T100000Z',
      'DTEND:20261104T103000Z',
      'SUMMARY:Appel de cadrage · Marie Dupont',
      'DESCRIPTION:Appel de cadrage de 30 minutes avec Marie Dupont.',
      'LOCATION:https://meet.jit.si/nedellec-abcdefgh12345678',
      'END:VEVENT',
      'END:VCALENDAR',
    ]);
  });

  it('Given un flux, Then aucune ligne METHOD, ORGANIZER ni ATTENDEE : un objet publié, pas un message iTIP', () => {
    const lines = contentLines(
      toIcsFeed(anIcsFeed({ events: [anIcsFeedEvent(), anIcsFeedEvent()] })),
    );

    expect(
      lines.filter((line) => /^(METHOD|ORGANIZER|ATTENDEE)[;:]/.test(line)),
    ).toEqual([]);
  });

  it.each([
    'NAME:',
    'X-WR-CALNAME:',
    'REFRESH-INTERVAL;VALUE=DURATION:',
    'X-PUBLISHED-TTL:',
  ])(
    'Given deux événements, Then la propriété %s figure une seule fois, hors des événements',
    (name) => {
      const lines = contentLines(
        toIcsFeed(anIcsFeed({ events: [anIcsFeedEvent(), anIcsFeedEvent()] })),
      );

      const found = lines.filter((line) => line.startsWith(name));
      expect(found).toHaveLength(1);
      expect(lines.indexOf(found[0])).toBeLessThan(
        lines.indexOf('BEGIN:VEVENT'),
      );
    },
  );

  it('Given deux événements, Then deux VEVENT dans l’ordre reçu', () => {
    const lines = contentLines(
      toIcsFeed(
        anIcsFeed({
          events: [
            anIcsFeedEvent({ uid: 'second-in-time' }),
            anIcsFeedEvent({ uid: 'first-in-time' }),
          ],
        }),
      ),
    );

    expect(lines.filter((line) => line === 'BEGIN:VEVENT')).toHaveLength(2);
    expect(lines.filter((line) => line === 'END:VEVENT')).toHaveLength(2);
    expect(lines.filter((line) => line.startsWith('UID:'))).toEqual([
      'UID:second-in-time',
      'UID:first-in-time',
    ]);
  });

  it('Given aucun événement, Then l’enveloppe seule', () => {
    expect(contentLines(toIcsFeed(anIcsFeed({ events: [] })))).toEqual([
      ...ENVELOPE_HEAD,
      'END:VCALENDAR',
    ]);
  });

  it('Given des valeurs TEXT avec virgule, point-virgule et retours à la ligne, Then elles sont échappées', () => {
    const lines = contentLines(
      toIcsFeed(
        anIcsFeed({
          events: [
            anIcsFeedEvent({
              summary: 'Appel de cadrage · Dupont, Marie',
              description: 'Message :\nUn; deux\r\ntrois',
            }),
          ],
        }),
      ),
    );

    expect(lines).toContain('SUMMARY:Appel de cadrage · Dupont\\, Marie');
    expect(lines).toContain('DESCRIPTION:Message :\\nUn\\; deux\\ntrois');
  });

  it.each([
    ['un événement', anIcsFeed()],
    ['aucun événement', anIcsFeed({ events: [] })],
    [
      'une description multiligne',
      anIcsFeed({ events: [anIcsFeedEvent({ description: 'a\nb\r\nc' })] }),
    ],
  ])('Given %s, Then CRLF partout, y compris en fin', (_case, feed) => {
    const ics = toIcsFeed(feed);

    expect(ics.endsWith('\r\n')).toBe(true);
    expect(ics).not.toMatch(/(?<!\r)\n/);
    expect(ics).not.toMatch(/\r(?!\n)/);
  });

  it('Given un nom de calendrier et un résumé à émojis, Then chaque ligne physique tient en 75 octets sans couper un caractère, et le dépliage les restitue', () => {
    const name = `Rendez-vous ${'📅'.repeat(30)}`;
    const summary = `Appel de cadrage · ${'🚀'.repeat(30)}`;

    const ics = toIcsFeed(
      anIcsFeed({ name, events: [anIcsFeedEvent({ summary })] }),
    );

    const lines = physicalLines(ics);
    expect(lines.length).toBeGreaterThan(ENVELOPE_HEAD.length + 12);
    for (const line of lines) {
      expect(bytes(line)).toBeLessThanOrEqual(75);
      expect(line).not.toMatch(LONE_SURROGATE);
    }
    expect(contentLines(ics)).toEqual(
      expect.arrayContaining([
        `NAME:${name}`,
        `X-WR-CALNAME:${name}`,
        `SUMMARY:${summary}`,
      ]),
    );
  });
});
