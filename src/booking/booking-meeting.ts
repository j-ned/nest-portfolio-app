import type { Booking } from '../database/schema';

/** Moyen de joindre le rendez-vous : lien de visio ou numéro du visiteur. */
export type Meeting = {
  label: string;
  href: string;
  value: string;
  hint: string;
  location: string;
};

/** Partagé par les invitations et le flux d'agenda : même ligne de contact, même `LOCATION`. */
export const meetingOf = (row: Booking): Meeting => {
  if (row.format === 'video' && row.videoUrl) {
    return {
      label: 'Lien de visio',
      href: row.videoUrl,
      value: row.videoUrl,
      hint: 'À l’heure du rendez-vous, ouvrez ce lien dans votre navigateur : aucune installation n’est nécessaire.',
      location: row.videoUrl,
    };
  }
  const phone = row.phone ?? '';
  return {
    label: 'Téléphone',
    href: `tel:${phone.replace(/[^+0-9]/g, '')}`,
    value: phone,
    hint: 'Je vous appellerai à ce numéro à l’heure du rendez-vous.',
    location: `Téléphone : ${phone}`,
  };
};
