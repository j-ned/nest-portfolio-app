import { meetingOf } from './booking-meeting';
import { aBooking } from './booking-test-builders';

const VIDEO_URL = 'https://meet.jit.si/nedellec-abcdefgh12345678';

describe('meetingOf', () => {
  it('Given un rendez-vous en visio, Then le lien de visio sert de valeur, de cible et de lieu', () => {
    expect(
      meetingOf(aBooking({ format: 'video', videoUrl: VIDEO_URL })),
    ).toEqual({
      label: 'Lien de visio',
      href: VIDEO_URL,
      value: VIDEO_URL,
      hint: 'À l’heure du rendez-vous, ouvrez ce lien dans votre navigateur : aucune installation n’est nécessaire.',
      location: VIDEO_URL,
    });
  });

  it('Given un rendez-vous par téléphone, Then le numéro du visiteur, composable en tel: sans espaces', () => {
    expect(
      meetingOf(
        aBooking({
          format: 'phone',
          videoUrl: null,
          phone: '+33 6 12 34 56 78',
        }),
      ),
    ).toEqual({
      label: 'Téléphone',
      href: 'tel:+33612345678',
      value: '+33 6 12 34 56 78',
      hint: 'Je vous appellerai à ce numéro à l’heure du rendez-vous.',
      location: 'Téléphone : +33 6 12 34 56 78',
    });
  });
});
