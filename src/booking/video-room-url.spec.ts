import { videoRoomUrl } from './video-room-url';

const SEQUENCE = Buffer.from(Array.from({ length: 16 }, (_, i) => i * 17));

describe('videoRoomUrl', () => {
  it.each([
    ['zéros', Buffer.alloc(16, 0)],
    ['octets maximaux', Buffer.alloc(16, 0xff)],
    ['suite croissante', SEQUENCE],
  ])(
    'Given un aléa de %s, Then une salle nedellec- suivie de 16 caractères [a-z0-9]',
    (_case, random) => {
      expect(videoRoomUrl('https://meet.jit.si', random)).toMatch(
        /^https:\/\/meet\.jit\.si\/nedellec-[a-z0-9]{16}$/,
      );
    },
  );

  it('Given une base terminée par une barre oblique, Then elle n’est pas doublée', () => {
    expect(videoRoomUrl('https://meet.jit.si/', SEQUENCE)).toBe(
      videoRoomUrl('https://meet.jit.si', SEQUENCE),
    );
  });

  it('Given une base Jitsi auto-hébergée avec chemin, Then la salle est ajoutée sous ce chemin', () => {
    expect(videoRoomUrl('https://visio.example.test/salles', SEQUENCE)).toMatch(
      /^https:\/\/visio\.example\.test\/salles\/nedellec-[a-z0-9]{16}$/,
    );
  });

  it('Given le même aléa, Then la même salle', () => {
    expect(videoRoomUrl('https://meet.jit.si', Buffer.from(SEQUENCE))).toBe(
      videoRoomUrl('https://meet.jit.si', SEQUENCE),
    );
  });

  it('Given deux aléas différents, Then deux salles différentes', () => {
    expect(videoRoomUrl('https://meet.jit.si', Buffer.alloc(16, 1))).not.toBe(
      videoRoomUrl('https://meet.jit.si', Buffer.alloc(16, 2)),
    );
  });

  it('Given deux aléas qui ne diffèrent que par le dernier octet, Then deux salles différentes', () => {
    const last = Buffer.from(SEQUENCE);
    last[15] = (last[15] + 1) % 256;

    expect(videoRoomUrl('https://meet.jit.si', last)).not.toBe(
      videoRoomUrl('https://meet.jit.si', SEQUENCE),
    );
  });
});
