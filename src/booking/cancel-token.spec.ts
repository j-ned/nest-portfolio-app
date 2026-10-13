import { createCancelToken, hashCancelToken } from './cancel-token';

describe('cancel-token', () => {
  it('Given un nouveau jeton, Then 43 caractères base64url', () => {
    const { token } = createCancelToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('Given un nouveau jeton, Then il encode 32 octets aléatoires', () => {
    const { token } = createCancelToken();

    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
  });

  it('Given un nouveau jeton, Then son empreinte est le SHA-256 hexadécimal du jeton', () => {
    const { token, hash } = createCancelToken();

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(hashCancelToken(token));
  });

  it('Given deux jetons créés à la suite, Then ni les jetons ni les empreintes ne se répètent', () => {
    const first = createCancelToken();
    const second = createCancelToken();

    expect(second.token).not.toBe(first.token);
    expect(second.hash).not.toBe(first.hash);
  });

  it.each([
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
  ])(
    'Given le jeton %p, When il est haché, Then l’empreinte SHA-256 de référence',
    (token, expected) => {
      expect(hashCancelToken(token)).toBe(expected);
    },
  );
});
