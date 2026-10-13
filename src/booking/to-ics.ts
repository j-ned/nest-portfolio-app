/** Invitation calendrier RFC 5545 (iTIP RFC 5546) d'un rendez-vous : un VEVENT, instants en UTC. */
export type IcsMethod = 'REQUEST' | 'CANCEL';

export type IcsPerson = { name: string; email: string };

export type IcsEvent = {
  method: IcsMethod;
  uid: string;
  stamp: Date;
  startsAt: Date;
  endsAt: Date;
  summary: string;
  description: string;
  location: string;
  organizer: IcsPerson;
  attendee: IcsPerson;
};

const CRLF = '\r\n';
const MAX_LINE_BYTES = 75;

/** Une annulation est une révision de l'invitation : séquence incrémentée, statut annulé. */
const REVISION: Record<IcsMethod, { sequence: number; status: string }> = {
  REQUEST: { sequence: 0, status: 'CONFIRMED' },
  CANCEL: { sequence: 1, status: 'CANCELLED' },
};

export function toIcs(event: IcsEvent): string {
  const { sequence, status } = REVISION[event.method];
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//nedellec-julien.fr//Booking//FR',
    'CALSCALE:GREGORIAN',
    `METHOD:${event.method}`,
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
    `ORGANIZER;CN=${paramValue(event.organizer.name)}:mailto:${event.organizer.email}`,
    `ATTENDEE;CN=${paramValue(event.attendee.name)};PARTSTAT=ACCEPTED:mailto:${event.attendee.email}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(foldLine).join(CRLF) + CRLF;
}

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
