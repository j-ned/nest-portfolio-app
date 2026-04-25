import { PasswordService } from './password.service';

describe('PasswordService', () => {
  let service: PasswordService;

  beforeEach(() => {
    service = new PasswordService();
  });

  it('hash et verify roundtrip', async () => {
    const plain = 'my-secret-password-123';
    const hash = await service.hash(plain);
    expect(hash).toMatch(/^\$argon2id\$/); // Argon2id encoded format
    expect(await service.verify(plain, hash)).toBe(true);
  });

  it('verify retourne false pour un mauvais password', async () => {
    const hash = await service.hash('correct-password');
    expect(await service.verify('wrong-password', hash)).toBe(false);
  });

  it('verify retourne false pour un hash malformé (pas de throw)', async () => {
    expect(await service.verify('any-password', 'not-a-valid-hash')).toBe(
      false,
    );
  });
});
