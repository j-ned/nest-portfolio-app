import { timingSafeEqual } from 'node:crypto';
import { parseFeedFile } from './booking-feed';
import {
  createFeedSalt,
  deriveFeedToken,
  feedTokenMatches,
} from './feed-token';

jest.mock('node:crypto', () => {
  const actual =
    jest.requireActual<typeof import('node:crypto')>('node:crypto');
  return { ...actual, timingSafeEqual: jest.fn(actual.timingSafeEqual) };
});

const SECRET = 'a'.repeat(32);
const SALT = 'AAAAAAAAAAAAAAAAAAAAAA';
const TOKEN = 'XYJXH9MoGdppkZYT0jI3g2rP-qFcqKBWL0budyMj488';

describe('deriveFeedToken', () => {
  it('Given un secret et un sel connus, Then le HMAC-SHA256 base64url du vecteur figé', () => {
    expect(deriveFeedToken(SECRET, SALT)).toBe(TOKEN);
  });

  it('Given deux appels avec les mêmes entrées, Then le même jeton', () => {
    expect(deriveFeedToken(SECRET, SALT)).toBe(deriveFeedToken(SECRET, SALT));
  });

  it('Given un jeton dérivé, Then 43 caractères base64url que parseFeedFile accepte', () => {
    const token = deriveFeedToken(SECRET, SALT);

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(parseFeedFile(`${token}.ics`)).toBe(token);
  });

  it.each([
    [
      'un autre sel',
      SECRET,
      'BBBBBBBBBBBBBBBBBBBBBB',
      'GBsig7nF0DROc6bD60UVSPVxMq9nhi5XA7A5Blh9U_c',
    ],
    [
      'un autre secret',
      'b'.repeat(32),
      SALT,
      'YIOEM-vZaqfWKVo3mlmOCSsc90Jm2NI6k_dPHGr2pzY',
    ],
  ])('Given %s, Then un autre jeton', (_case, secret, salt, expected) => {
    expect(deriveFeedToken(secret, salt)).toBe(expected);
  });
});

describe('createFeedSalt', () => {
  it('Given un tirage, Then 16 octets en base64url, soit 22 caractères', () => {
    const salt = createFeedSalt();

    expect(salt).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(Buffer.from(salt, 'base64url')).toHaveLength(16);
  });

  it('Given deux tirages, Then deux sels différents', () => {
    expect(createFeedSalt()).not.toBe(createFeedSalt());
  });
});

describe('feedTokenMatches', () => {
  const compare = jest.mocked(timingSafeEqual);

  beforeEach(() => compare.mockClear());

  it('Given le jeton attendu, Then vrai', () => {
    expect(feedTokenMatches(TOKEN, TOKEN)).toBe(true);
  });

  it('Given un jeton qui diffère d’un caractère, Then faux', () => {
    const candidate = `${TOKEN.slice(0, -1)}9`;

    expect(feedTokenMatches(candidate, TOKEN)).toBe(false);
  });

  it.each([
    ['plus court', TOKEN.slice(0, 42)],
    ['plus long', `${TOKEN}A`],
    ['vide', ''],
  ])(
    'Given un candidat %s, Then faux sans exception et sans comparaison à temps constant',
    (_case, candidate) => {
      expect(() => feedTokenMatches(candidate, TOKEN)).not.toThrow();
      expect(feedTokenMatches(candidate, TOKEN)).toBe(false);
      expect(compare).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['égaux', TOKEN, true],
    ['différents', `${TOKEN.slice(0, -1)}9`, false],
  ])(
    'Given deux jetons de même longueur %s, Then la comparaison passe par timingSafeEqual',
    (_case, candidate, expected) => {
      expect(feedTokenMatches(candidate, TOKEN)).toBe(expected);
      expect(compare).toHaveBeenCalledTimes(1);
    },
  );
});
