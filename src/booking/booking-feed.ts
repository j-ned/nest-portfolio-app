import type { Booking } from '../database/schema';
import { meetingOf } from './booking-meeting';
import type { IcsFeedEvent } from './to-ics';

/** Flux d'agenda des rendez-vous (ADR-0028) ; la fenêtre est `BOOKING_POLICY.retentionMonths`. */
export const BOOKING_FEED = {
  refreshMinutes: 15,
  calendarName: 'Rendez-vous nedellec-julien.fr',
} as const;

const FEED_FILE = /^([A-Za-z0-9_-]{43})\.ics$/;

/** `<jeton>.ics` → le jeton ; toute autre forme → `null`, sans indiquer laquelle. */
export function parseFeedFile(file: string): string | null {
  return FEED_FILE.exec(file)?.[1] ?? null;
}

/** Événement du flux : `DTSTAMP` = création du rendez-vous, stable d'une lecture à l'autre. */
export function toFeedEvent(row: Booking, siteUrl: string): IcsFeedEvent {
  const meeting = meetingOf(row);
  const description = [
    `Appel de cadrage de 30 minutes avec ${row.name}.`,
    `${meeting.label} : ${meeting.value}`,
    `Email : ${row.email}`,
    ...(row.format === 'video' && row.phone
      ? [`Téléphone : ${row.phone}`]
      : []),
    ...(row.company ? [`Société : ${row.company}`] : []),
    'Message :',
    row.message,
    `Gérer : ${siteUrl}/admin/rendez-vous`,
  ].join('\n');
  return {
    uid: row.id,
    stamp: row.createdAt,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    summary: `Appel de cadrage · ${row.name}`,
    description,
    location: meeting.location,
  };
}
