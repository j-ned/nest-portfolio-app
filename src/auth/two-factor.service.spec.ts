import { generateSync } from 'otplib';
import { Test, TestingModule } from '@nestjs/testing';
import { TwoFactorService } from './two-factor.service';
import { AppConfigService } from '../config/app-config.service';

describe('TwoFactorService', () => {
  let service: TwoFactorService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TwoFactorService,
        { provide: AppConfigService, useValue: { totpAppName: 'Test App' } },
      ],
    }).compile();
    service = module.get<TwoFactorService>(TwoFactorService);
  });

  it('generateSecret retourne un secret base32 valide', () => {
    const secret = service.generateSecret();
    expect(secret).toMatch(/^[A-Z2-7]+=*$/); // base32 alphabet
    expect(secret.length).toBeGreaterThanOrEqual(16);
  });

  it('verifyTotpCode accepte un code calculé depuis le secret', () => {
    const secret = service.generateSecret();
    const code = generateSync({ secret });
    expect(service.verifyTotpCode(secret, code)).toBe(true);
  });

  it('verifyTotpCode rejette un code invalide', () => {
    const secret = service.generateSecret();
    expect(service.verifyTotpCode(secret, '000000')).toBe(false);
  });

  it('generateQrCodeDataUrl retourne une data URL PNG', async () => {
    const secret = service.generateSecret();
    const dataUrl = await service.generateQrCodeDataUrl(
      'user@example.com',
      secret,
    );
    expect(dataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it('generateBackupCodes retourne 10 codes au format xxxx-xxxx', () => {
    const codes = service.generateBackupCodes();
    expect(codes).toHaveLength(10);
    for (const code of codes) {
      expect(code).toMatch(/^[a-z0-9]{4}-[a-z0-9]{4}$/);
    }
    // Tous uniques
    expect(new Set(codes).size).toBe(10);
  });

  it('hashBackupCodes hash chaque code et findMatchingBackupCode trouve le bon hash', async () => {
    const codes = service.generateBackupCodes();
    const hashes = await service.hashBackupCodes(codes);
    expect(hashes).toHaveLength(10);
    for (const hash of hashes) {
      expect(hash).toMatch(/^\$argon2id\$/);
    }
    // Trouve le hash correspondant au 5e code
    const matchHash = await service.findMatchingBackupCode(codes[5], hashes);
    expect(matchHash).toBe(hashes[5]);
  }, 30000);

  it('findMatchingBackupCode retourne null si aucun match', async () => {
    const codes = service.generateBackupCodes();
    const hashes = await service.hashBackupCodes(codes);
    const matchHash = await service.findMatchingBackupCode('zzzz-zzzz', hashes);
    expect(matchHash).toBeNull();
  }, 30000);

  it('findMatchingBackupCode retourne null sur tableau vide', async () => {
    const matchHash = await service.findMatchingBackupCode('a1b2-c3d4', []);
    expect(matchHash).toBeNull();
  });
});
