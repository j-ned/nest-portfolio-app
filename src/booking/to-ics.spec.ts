import { toIcs } from './to-ics';

type IcsEvent = Parameters<typeof toIcs>[0];

const icsEvent = (overrides: Partial<IcsEvent> = {}): IcsEvent => ({
  method: 'REQUEST',
  uid: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  stamp: new Date('2026-11-02T08:00:00Z'),
  startsAt: new Date('2026-11-04T10:00:00Z'),
  endsAt: new Date('2026-11-04T10:30:00Z'),
  summary: 'Appel de cadrage · 30 min',
  description: 'Rendez-vous avec Julien Nédellec.',
  location: 'https://meet.jit.si/nedellec-abcdefgh12345678',
  organizer: { name: 'Julien Nédellec', email: 'contact@nedellec-julien.fr' },
  attendee: { name: 'Camille Martin', email: 'camille@example.com' },
  ...overrides,
});

const unfold = (ics: string): string => ics.replace(/\r\n[ \t]/g, '');
const contentLines = (ics: string): string[] =>
  unfold(ics)
    .split('\r\n')
    .filter((line) => line !== '');
const physicalLines = (ics: string): string[] =>
  ics.split('\r\n').filter((line) => line !== '');
const lineStartingWith = (ics: string, name: string): string | undefined =>
  contentLines(ics).find((line) => line.startsWith(name));
const bytes = (line: string): number => Buffer.byteLength(line, 'utf8');
const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

describe('toIcs', () => {
  describe('invitation', () => {
    it('Given une invitation, Then un VCALENDAR qui enveloppe un seul VEVENT, méthode hors de l’événement', () => {
      const lines = contentLines(toIcs(icsEvent()));

      expect(lines[0]).toBe('BEGIN:VCALENDAR');
      expect(lines.at(-1)).toBe('END:VCALENDAR');
      expect(lines).toContain('VERSION:2.0');
      expect(lines.some((line) => /^PRODID:.+/.test(line))).toBe(true);
      expect(lines.filter((line) => line === 'BEGIN:VEVENT')).toHaveLength(1);
      const begin = lines.indexOf('BEGIN:VEVENT');
      const end = lines.indexOf('END:VEVENT');
      expect(lines.indexOf('METHOD:REQUEST')).toBeGreaterThan(0);
      expect(lines.indexOf('METHOD:REQUEST')).toBeLessThan(begin);
      expect(end).toBe(lines.length - 2);
    });

    it('Given une invitation, Then UID = id du rendez-vous, SEQUENCE 0, STATUS CONFIRMED, horodatages UTC', () => {
      const lines = contentLines(toIcs(icsEvent()));
      const event = lines.slice(
        lines.indexOf('BEGIN:VEVENT'),
        lines.indexOf('END:VEVENT'),
      );

      expect(event).toEqual(
        expect.arrayContaining([
          'UID:dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          'SEQUENCE:0',
          'STATUS:CONFIRMED',
          'DTSTAMP:20261102T080000Z',
          'DTSTART:20261104T100000Z',
          'DTEND:20261104T103000Z',
          'SUMMARY:Appel de cadrage · 30 min',
          'DESCRIPTION:Rendez-vous avec Julien Nédellec.',
          'LOCATION:https://meet.jit.si/nedellec-abcdefgh12345678',
        ]),
      );
    });

    it.each([
      ['2026-10-25T00:30:00.000Z', 'DTSTART:20261025T003000Z'],
      ['2027-03-28T01:00:00.000Z', 'DTSTART:20270328T010000Z'],
      ['2026-12-31T23:59:59.999Z', 'DTSTART:20261231T235959Z'],
    ])(
      'Given un début à %s, Then %s (instant UTC, millisecondes tronquées)',
      (startsAt, expected) => {
        const ics = toIcs(icsEvent({ startsAt: new Date(startsAt) }));

        expect(lineStartingWith(ics, 'DTSTART')).toBe(expected);
      },
    );

    it('Given un organisateur et un participant, Then ORGANIZER et ATTENDEE en mailto avec leur nom', () => {
      const ics = toIcs(icsEvent());

      expect(lineStartingWith(ics, 'ORGANIZER')).toBe(
        'ORGANIZER;CN=Julien Nédellec:mailto:contact@nedellec-julien.fr',
      );
      const attendee = lineStartingWith(ics, 'ATTENDEE') ?? '';
      expect(attendee).toMatch(/^ATTENDEE[;:]/);
      expect(attendee).toContain(';CN=Camille Martin');
      expect(attendee.endsWith(':mailto:camille@example.com')).toBe(true);
    });

    it.each([
      ['une virgule', 'Martin, Camille'],
      ['un point-virgule', 'Martin; Camille'],
      ['deux-points', 'Société: Camille'],
    ])(
      'Given un nom de participant avec %s, Then le CN est entre guillemets',
      (_case, name) => {
        const ics = toIcs(
          icsEvent({ attendee: { name, email: 'camille@example.com' } }),
        );

        const attendee = lineStartingWith(ics, 'ATTENDEE') ?? '';
        expect(attendee).toContain(`;CN="${name}"`);
        expect(attendee.endsWith(':mailto:camille@example.com')).toBe(true);
      },
    );
  });

  describe('annulation', () => {
    it('Given une annulation, Then METHOD CANCEL, SEQUENCE 1, STATUS CANCELLED, même UID et mêmes dates que l’invitation', () => {
      const request = contentLines(toIcs(icsEvent()));
      const cancel = contentLines(toIcs(icsEvent({ method: 'CANCEL' })));

      expect(cancel).toEqual(
        expect.arrayContaining([
          'METHOD:CANCEL',
          'SEQUENCE:1',
          'STATUS:CANCELLED',
        ]),
      );
      expect(cancel).not.toContain('METHOD:REQUEST');
      expect(cancel).not.toContain('SEQUENCE:0');
      for (const name of ['UID:', 'DTSTART:', 'DTEND:']) {
        expect(cancel.find((line) => line.startsWith(name))).toBe(
          request.find((line) => line.startsWith(name)),
        );
      }
    });
  });

  describe('copie publiée (sans participant)', () => {
    it('Given une publication, Then METHOD PUBLISH, SEQUENCE 0, STATUS CONFIRMED, organisateur présent', () => {
      const lines = contentLines(
        toIcs(icsEvent({ method: 'PUBLISH', attendee: undefined })),
      );

      expect(lines).toEqual(
        expect.arrayContaining([
          'METHOD:PUBLISH',
          'SEQUENCE:0',
          'STATUS:CONFIRMED',
          'UID:dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          'ORGANIZER;CN=Julien Nédellec:mailto:contact@nedellec-julien.fr',
        ]),
      );
    });

    it.each([
      ['sans participant', undefined],
      [
        'même si un participant est fourni',
        { name: 'Camille Martin', email: 'camille@example.com' },
      ],
    ])(
      'Given une publication %s, Then aucune ligne ATTENDEE ni RSVP',
      (_case, attendee) => {
        const ics = toIcs(icsEvent({ method: 'PUBLISH', attendee }));

        expect(lineStartingWith(ics, 'ATTENDEE')).toBeUndefined();
        expect(unfold(ics)).not.toContain('RSVP');
      },
    );

    it('Given l’annulation d’une publication, Then METHOD CANCEL, SEQUENCE 1, STATUS CANCELLED, même UID, sans ATTENDEE', () => {
      const published = contentLines(
        toIcs(icsEvent({ method: 'PUBLISH', attendee: undefined })),
      );
      const ics = toIcs(icsEvent({ method: 'CANCEL', attendee: undefined }));
      const cancel = contentLines(ics);

      expect(cancel).toEqual(
        expect.arrayContaining([
          'METHOD:CANCEL',
          'SEQUENCE:1',
          'STATUS:CANCELLED',
        ]),
      );
      expect(cancel.find((line) => line.startsWith('UID:'))).toBe(
        published.find((line) => line.startsWith('UID:')),
      );
      expect(lineStartingWith(ics, 'ATTENDEE')).toBeUndefined();
      expect(lineStartingWith(ics, 'ORGANIZER')).toBe(
        'ORGANIZER;CN=Julien Nédellec:mailto:contact@nedellec-julien.fr',
      );
    });
  });

  describe('fins de ligne', () => {
    it.each([
      ['une invitation', icsEvent()],
      [
        'une annulation au texte multiligne',
        icsEvent({ method: 'CANCEL', description: 'a\nb\r\nc' }),
      ],
    ])('Given %s, Then CRLF partout, y compris en fin', (_case, event) => {
      const ics = toIcs(event);

      expect(ics.endsWith('\r\n')).toBe(true);
      expect(ics).not.toMatch(/(?<!\r)\n/);
      expect(ics).not.toMatch(/\r(?!\n)/);
    });
  });

  describe('repli des lignes à 75 octets', () => {
    it('Given une ligne de contenu de 75 octets, Then elle n’est pas repliée', () => {
      const description = 'a'.repeat(75 - 'DESCRIPTION:'.length);

      const ics = toIcs(icsEvent({ description }));

      expect(physicalLines(ics)).toContain(`DESCRIPTION:${description}`);
    });

    it('Given une ligne de contenu de 76 octets, Then elle est repliée en deux lignes physiques', () => {
      const description = 'a'.repeat(76 - 'DESCRIPTION:'.length);

      const ics = toIcs(icsEvent({ description }));

      const lines = physicalLines(ics);
      const start = lines.findIndex((line) => line.startsWith('DESCRIPTION:'));
      expect(bytes(lines[start])).toBe(75);
      expect(lines[start + 1]).toBe(' a');
      expect(lineStartingWith(ics, 'DESCRIPTION:')).toBe(
        `DESCRIPTION:${description}`,
      );
    });

    it.each([
      ['ASCII long', 'x'.repeat(300)],
      ['accents (2 octets)', `${'é'.repeat(120)}`],
      ['accents décalés d’un octet', `a${'é'.repeat(120)}`],
      ['symboles de 3 octets', `${'€'.repeat(90)}`],
      ['symboles de 3 octets décalés', `ab${'€'.repeat(90)}`],
      ['émojis de 4 octets', `${'📅'.repeat(60)}`],
      ['émojis de 4 octets décalés', `abc${'📅'.repeat(60)}`],
      [
        'nom accentué réaliste',
        'Rendez-vous avec Hélène-Éléonore Bérénice d’Arçonville-Kerhervé, société Éditions Ç&Œ, projet « refonte » 🚀',
      ],
    ])(
      'Given une description %s, Then chaque ligne physique tient en 75 octets, sans couper un caractère, et le dépliage la restitue',
      (_case, description) => {
        const ics = toIcs(icsEvent({ description }));

        const lines = physicalLines(ics);
        expect(lines.length).toBeGreaterThan(0);
        for (const line of lines) {
          expect(bytes(line)).toBeLessThanOrEqual(75);
          expect(line).not.toContain('\uFFFD');
          expect(line).not.toMatch(LONE_SURROGATE);
        }
        expect(lineStartingWith(ics, 'DESCRIPTION:')).toBe(
          `DESCRIPTION:${description.replace(/,/g, '\\,')}`,
        );
      },
    );

    it('Given une ligne repliée, Then chaque continuation commence par une seule espace', () => {
      const ics = toIcs(icsEvent({ description: 'é'.repeat(200) }));

      const lines = physicalLines(ics);
      const start = lines.findIndex((line) => line.startsWith('DESCRIPTION:'));
      const continuations = lines
        .slice(start + 1)
        .filter((line) => line.startsWith(' '));
      expect(continuations.length).toBeGreaterThanOrEqual(5);
      for (const line of continuations) {
        expect(line).toMatch(/^ é/);
      }
    });
  });

  describe('échappement des TEXT', () => {
    it.each([
      ['barre oblique inverse', 'a\\b', 'a\\\\b'],
      ['point-virgule', 'a;b', 'a\\;b'],
      ['virgule', 'a,b', 'a\\,b'],
      ['saut de ligne', 'a\nb', 'a\\nb'],
      ['CRLF', 'a\r\nb', 'a\\nb'],
      ['deux-points laissés tels quels', 'a:b', 'a:b'],
      [
        'tout à la fois',
        'Ligne 1\nLigne 2; a, b \\ c',
        'Ligne 1\\nLigne 2\\; a\\, b \\\\ c',
      ],
    ])('Given %s dans la description, Then %s', (_case, raw, escaped) => {
      const ics = toIcs(icsEvent({ description: raw }));

      expect(lineStartingWith(ics, 'DESCRIPTION:')).toBe(
        `DESCRIPTION:${escaped}`,
      );
    });

    it.each([
      ['SUMMARY:', { summary: 'Cadrage; projet, phase 1' }],
      ['LOCATION:', { location: 'Téléphone, au +33 6 12 34 56 78; rappel' }],
    ] as const)(
      'Given des caractères spéciaux, Then %s est échappé comme la description',
      (name, override) => {
        const ics = toIcs(icsEvent(override));
        const raw = Object.values(override)[0];

        expect(lineStartingWith(ics, name)).toBe(
          `${name}${raw.replace(/;/g, '\\;').replace(/,/g, '\\,')}`,
        );
      },
    );
  });
});
