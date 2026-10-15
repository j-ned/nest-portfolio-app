import type { CalendarMethod } from '../mailer/mailer.service';

export type IcsPerson = { name: string; email: string };

/** Invitation calendrier RFC 5545 (iTIP RFC 5546) d'un rendez-vous : un VEVENT, instants en UTC. */
export type IcsEvent = {
  method: CalendarMethod;
  uid: string;
  stamp: Date;
  startsAt: Date;
  endsAt: Date;
  summary: string;
  description: string;
  location: string;
  organizer: IcsPerson;
  /** Ignoré en `PUBLISH` : un événement publié ne nomme aucun participant (RFC 5546 §3.2.1). */
  attendee?: IcsPerson;
};

export type IcsFeedEvent = {
  uid: string;
  stamp: Date;
  startsAt: Date;
  endsAt: Date;
  summary: string;
  description: string;
  location: string;
};

export type IcsFeed = {
  name: string;
  refreshMinutes: number;
  events: readonly IcsFeedEvent[];
};

const CRLF = '\r\n';
const MAX_LINE_BYTES = 75;

/** Une annulation est une révision de l'invitation : séquence incrémentée, statut annulé. */
const REVISION: Record<CalendarMethod, { sequence: number; status: string }> = {
  REQUEST: { sequence: 0, status: 'CONFIRMED' },
  PUBLISH: { sequence: 0, status: 'CONFIRMED' },
  CANCEL: { sequence: 1, status: 'CANCELLED' },
};

export function toIcs(event: IcsEvent): string {
  const { sequence, status } = REVISION[event.method];
  const attendee = event.method === 'PUBLISH' ? undefined : event.attendee;
  return serialize(
    calendarLines(
      [`METHOD:${event.method}`],
      [
        veventLines(event, sequence, status, [
          `ORGANIZER;CN=${paramValue(event.organizer.name)}:mailto:${event.organizer.email}`,
          ...(attendee
            ? [
                `ATTENDEE;CN=${paramValue(attendee.name)};PARTSTAT=ACCEPTED:mailto:${attendee.email}`,
              ]
            : []),
        ]),
      ],
    ),
  );
}

/**
 * Calendrier publié par abonnement (RFC 5545, RFC 7986 §5.1 et §5.7) : un objet, pas un message
 * iTIP, donc ni `METHOD` ni participants. Sans événement, l'enveloppe est rendue seule.
 */
export function toIcsFeed(feed: IcsFeed): string {
  const refresh = `PT${feed.refreshMinutes}M`;
  return serialize(
    calendarLines(
      [
        `NAME:${escapeText(feed.name)}`,
        `X-WR-CALNAME:${escapeText(feed.name)}`,
        `REFRESH-INTERVAL;VALUE=DURATION:${refresh}`,
        `X-PUBLISHED-TTL:${refresh}`,
      ],
      feed.events.map((event) => veventLines(event, 0, 'CONFIRMED', [])),
    ),
  );
}

const calendarLines = (
  properties: readonly string[],
  events: readonly (readonly string[])[],
): string[] => [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//nedellec-julien.fr//Booking//FR',
  'CALSCALE:GREGORIAN',
  ...properties,
  ...events.flat(),
  'END:VCALENDAR',
];

/** Lignes communes d'un VEVENT, de `UID` à `LOCATION`, suivies des propriétés propres à l'appelant. */
const veventLines = (
  event: IcsFeedEvent,
  sequence: number,
  status: string,
  extra: readonly string[],
): string[] => [
  'BEGIN:VEVENT',
  `UID:${event.uid}`,
  `SEQUENCE:${sequence}`,
  `STATUS:${status}`,
  `DTSTAMP:${toUtcStamp(event.stamp)}`,
  `DTSTART:${toUtcStamp(event.startsAt)}`,
  `DTEND:${toUtcStamp(event.endsAt)}`,
  `SUMMARY:${escapeText(event.summary)}`,
  `DESCRIPTION:${escapeText(event.description)}`,
  `LOCATION:${escapeText(event.location)}`,
  ...extra,
  'END:VEVENT',
];

const serialize = (lines: readonly string[]): string =>
  lines.map(foldLine).join(CRLF) + CRLF;

/** `20261104T100000Z` : ISO 8601 de base, millisecondes tronquées. */
const toUtcStamp = (instant: Date): string =>
  instant
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/[-:]/g, '');

/** Échappement des valeurs TEXT (RFC 5545 §3.3.11) ; `:` n'a pas à l'être. */
const escapeText = (value: string): string =>
  value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');

/** Valeur de paramètre (RFC 5545 §3.2) : entre guillemets si elle contient `,` `;` ou `:`. */
const paramValue = (value: string): string => {
  const safe = value.replace(/["\r\n]/g, '');
  return /[,;:]/.test(safe) ? `"${safe}"` : safe;
};

/**
 * Repli à 75 octets UTF-8 (RFC 5545 §3.1) : chaque continuation commence par une espace, un
 * caractère n'est jamais coupé (itération par point de code, émojis compris).
 */
const foldLine = (line: string): string => {
  const physical: string[] = [];
  let current = '';
  let currentBytes = 0;
  for (const char of line) {
    const charBytes = Buffer.byteLength(char, 'utf8');
    if (currentBytes + charBytes > MAX_LINE_BYTES) {
      physical.push(current);
      current = ' ';
      currentBytes = 1;
    }
    current += char;
    currentBytes += charBytes;
  }
  physical.push(current);
  return physical.join(CRLF);
};
