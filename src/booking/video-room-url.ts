const ROOM_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const ROOM_LENGTH = 16;

/**
 * Lien de salle de visio `${base}/nedellec-<16 caractères [a-z0-9]>`. Pur : l'aléa (16 octets) est
 * injecté, chaque octet donne un caractère.
 */
export function videoRoomUrl(base: string, random: Buffer): string {
  const room = Array.from(
    random.subarray(0, ROOM_LENGTH),
    (byte) => ROOM_ALPHABET[byte % ROOM_ALPHABET.length],
  ).join('');
  return `${base.replace(/\/+$/, '')}/nedellec-${room}`;
}
