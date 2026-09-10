import { normalizeReferrer } from './referrer';

const SITE = ['https://nedellec-julien.fr', 'https://www.nedellec-julien.fr'];

describe('normalizeReferrer', () => {
  it.each([
    ['https://www.google.com/', 'google.com'],
    ['https://google.com/search?q=angular', 'google.com'],
    ['https://github.com/j-ned', 'github.com'],
    ['https://WWW.LinkedIn.com/feed/', 'linkedin.com'],
    ['http://t.co/abc', 't.co'],
    ['android-app://com.google.android.gm/', 'com.google.android.gm'],
  ])('source externe %s → %s', (raw, expected) => {
    expect(normalizeReferrer(raw, SITE)).toBe(expected);
  });

  it.each([
    ['https://nedellec-julien.fr/admin/analytics', 'admin'],
    ['https://nedellec-julien.fr/', 'accueil'],
    ['https://www.nedellec-julien.fr/blog', 'sous-domaine www'],
    ['http://NEDELLEC-JULIEN.fr/projects', 'casse et schéma différents'],
  ])('navigation interne %s (%s) → null', (raw) => {
    expect(normalizeReferrer(raw, SITE)).toBeNull();
  });

  it.each([
    [undefined, 'absent'],
    ['', 'vide'],
    ['not a url', 'texte libre'],
    ['/relative/path', 'chemin relatif'],
  ])('valeur %s (%s) → null', (raw) => {
    expect(normalizeReferrer(raw, SITE)).toBeNull();
  });

  it('ignore une origine de configuration invalide sans planter', () => {
    expect(
      normalizeReferrer('https://google.com/', [
        'nope',
        'https://nedellec-julien.fr',
      ]),
    ).toBe('google.com');
    expect(
      normalizeReferrer('https://nedellec-julien.fr/', [
        'nope',
        'https://nedellec-julien.fr',
      ]),
    ).toBeNull();
  });
});
