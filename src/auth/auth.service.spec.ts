import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { PasswordService } from './password.service';
import { TwoFactorService } from './two-factor.service';
import { AppConfigService } from '../config/app-config.service';
import type { User } from '../database/schema/users';

describe('AuthService', () => {
  let service: AuthService;
  let users: jest.Mocked<UsersService>;
  let password: jest.Mocked<PasswordService>;
  let twoFactor: jest.Mocked<TwoFactorService>;
  let jwt: jest.Mocked<JwtService>;

  const mkUser = (overrides: Partial<User> = {}): User => ({
    id: 'user-123',
    email: 'admin@example.com',
    passwordHash: '$argon2id$...',
    isTwoFactorEnabled: false,
    twoFactorSecret: null,
    twoFactorBackupCodesHash: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: {
          findById: jest.fn(),
          findByEmail: jest.fn(),
          updatePassword: jest.fn(),
          updateTwoFactorSecret: jest.fn(),
          enableTwoFactor: jest.fn(),
          disableTwoFactor: jest.fn(),
          replaceBackupCodes: jest.fn(),
          consumeBackupCode: jest.fn(),
        } },
        { provide: PasswordService, useValue: {
          hash: jest.fn(),
          verify: jest.fn(),
        } },
        { provide: TwoFactorService, useValue: {
          generateSecret: jest.fn(),
          generateQrCodeDataUrl: jest.fn(),
          verifyTotpCode: jest.fn(),
          generateBackupCodes: jest.fn(),
          hashBackupCodes: jest.fn(),
          findMatchingBackupCode: jest.fn(),
        } },
        { provide: JwtService, useValue: {
          sign: jest.fn(),
          verify: jest.fn(),
        } },
        { provide: AppConfigService, useValue: { jwtExpiresIn: '7d' } },
      ],
    }).compile();

    service = module.get(AuthService);
    users = module.get(UsersService);
    password = module.get(PasswordService);
    twoFactor = module.get(TwoFactorService);
    jwt = module.get(JwtService);
  });

  describe('login', () => {
    it('retourne un token quand credentials valides et 2FA disabled', async () => {
      const user = mkUser();
      users.findByEmail.mockResolvedValue(user);
      password.verify.mockResolvedValue(true);
      jwt.sign.mockReturnValue('jwt-token-final');

      const result = await service.login('admin@example.com', 'good-password');
      expect(result).toEqual({
        kind: 'authenticated',
        token: 'jwt-token-final',
        user: { id: user.id, email: user.email, isTwoFactorEnabled: false },
      });
      expect(jwt.sign).toHaveBeenCalledWith({ sub: user.id });
    });

    it('retourne un challengeToken quand 2FA enabled', async () => {
      const user = mkUser({ isTwoFactorEnabled: true, twoFactorSecret: 'SECRET' });
      users.findByEmail.mockResolvedValue(user);
      password.verify.mockResolvedValue(true);
      jwt.sign.mockReturnValue('challenge-token');

      const result = await service.login('admin@example.com', 'good-password');
      expect(result).toEqual({ kind: 'challenge', challengeToken: 'challenge-token' });
      expect(jwt.sign).toHaveBeenCalledWith(
        { sub: user.id, scope: '2fa-challenge' },
        { expiresIn: '5m' },
      );
    });

    it('throw UnauthorizedException si user inconnu', async () => {
      users.findByEmail.mockResolvedValue(null);
      await expect(service.login('nope@example.com', 'pw')).rejects.toThrow(UnauthorizedException);
    });

    it('throw UnauthorizedException si password incorrect', async () => {
      users.findByEmail.mockResolvedValue(mkUser());
      password.verify.mockResolvedValue(false);
      await expect(service.login('admin@example.com', 'bad')).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('verifyTwoFactor', () => {
    it('accepte un code TOTP valide et retourne le token final', async () => {
      const user = mkUser({ isTwoFactorEnabled: true, twoFactorSecret: 'SECRET', twoFactorBackupCodesHash: ['h1', 'h2'] });
      jwt.verify.mockReturnValue({ sub: user.id, scope: '2fa-challenge' });
      users.findById.mockResolvedValue(user);
      twoFactor.verifyTotpCode.mockReturnValue(true);
      jwt.sign.mockReturnValue('final-token');

      const result = await service.verifyTwoFactor('challenge', { code: '123456' });
      expect(result).toEqual({
        token: 'final-token',
        user: { id: user.id, email: user.email, isTwoFactorEnabled: true },
      });
      expect(twoFactor.verifyTotpCode).toHaveBeenCalledWith('SECRET', '123456');
      expect(users.consumeBackupCode).not.toHaveBeenCalled();
    });

    it('accepte un backup code valide, le consomme, retourne le token final', async () => {
      const user = mkUser({ isTwoFactorEnabled: true, twoFactorSecret: 'SECRET', twoFactorBackupCodesHash: ['h1', 'h2', 'h3'] });
      jwt.verify.mockReturnValue({ sub: user.id, scope: '2fa-challenge' });
      users.findById.mockResolvedValue(user);
      twoFactor.findMatchingBackupCode.mockResolvedValue('h2');
      jwt.sign.mockReturnValue('final-token');

      const result = await service.verifyTwoFactor('challenge', { backupCode: 'a1b2-c3d4' });
      expect(result.token).toBe('final-token');
      expect(users.consumeBackupCode).toHaveBeenCalledWith(user.id, 'h2');
    });

    it('throw UnauthorizedException si challengeToken sans bon scope', async () => {
      jwt.verify.mockReturnValue({ sub: 'user-123' });   // pas de scope
      await expect(service.verifyTwoFactor('bad', { code: '123456' })).rejects.toThrow(UnauthorizedException);
    });

    it('throw UnauthorizedException si code TOTP invalide', async () => {
      const user = mkUser({ isTwoFactorEnabled: true, twoFactorSecret: 'SECRET' });
      jwt.verify.mockReturnValue({ sub: user.id, scope: '2fa-challenge' });
      users.findById.mockResolvedValue(user);
      twoFactor.verifyTotpCode.mockReturnValue(false);
      await expect(service.verifyTwoFactor('challenge', { code: '000000' })).rejects.toThrow(UnauthorizedException);
    });

    it('throw UnauthorizedException si backup code ne matche aucun hash', async () => {
      const user = mkUser({ isTwoFactorEnabled: true, twoFactorSecret: 'SECRET', twoFactorBackupCodesHash: ['h1'] });
      jwt.verify.mockReturnValue({ sub: user.id, scope: '2fa-challenge' });
      users.findById.mockResolvedValue(user);
      twoFactor.findMatchingBackupCode.mockResolvedValue(null);
      await expect(service.verifyTwoFactor('challenge', { backupCode: 'zzzz-zzzz' })).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('changePassword', () => {
    it('met à jour le password si currentPassword est valide', async () => {
      const user = mkUser();
      password.verify.mockResolvedValue(true);
      password.hash.mockResolvedValue('new-hash');
      await service.changePassword(user, 'old', 'new-password-12');
      expect(password.hash).toHaveBeenCalledWith('new-password-12');
      expect(users.updatePassword).toHaveBeenCalledWith(user.id, 'new-hash');
    });

    it('throw UnauthorizedException si currentPassword invalide', async () => {
      const user = mkUser();
      password.verify.mockResolvedValue(false);
      await expect(service.changePassword(user, 'wrong', 'new')).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('generateTwoFactorSecret', () => {
    it('throw BadRequestException si déjà enabled', async () => {
      const user = mkUser({ isTwoFactorEnabled: true });
      await expect(service.generateTwoFactorSecret(user)).rejects.toThrow(BadRequestException);
    });

    it('génère secret + QR code et persiste', async () => {
      const user = mkUser();
      twoFactor.generateSecret.mockReturnValue('NEW-SECRET');
      twoFactor.generateQrCodeDataUrl.mockResolvedValue('data:image/png;base64,XYZ');
      const result = await service.generateTwoFactorSecret(user);
      expect(result).toEqual({ secret: 'NEW-SECRET', qrCodeDataUrl: 'data:image/png;base64,XYZ' });
      expect(users.updateTwoFactorSecret).toHaveBeenCalledWith(user.id, 'NEW-SECRET');
    });
  });

  describe('enableTwoFactor', () => {
    it('throw BadRequestException si pas de secret en attente', async () => {
      const user = mkUser({ twoFactorSecret: null });
      await expect(service.enableTwoFactor(user, '123456')).rejects.toThrow(BadRequestException);
    });

    it('throw UnauthorizedException si code invalide', async () => {
      const user = mkUser({ twoFactorSecret: 'SECRET' });
      twoFactor.verifyTotpCode.mockReturnValue(false);
      await expect(service.enableTwoFactor(user, '000000')).rejects.toThrow(UnauthorizedException);
    });

    it('génère + hash backup codes et active 2FA si code valide', async () => {
      const user = mkUser({ twoFactorSecret: 'SECRET' });
      twoFactor.verifyTotpCode.mockReturnValue(true);
      twoFactor.generateBackupCodes.mockReturnValue(['a1b2-c3d4', 'e5f6-g7h8']);
      twoFactor.hashBackupCodes.mockResolvedValue(['hash1', 'hash2']);

      const result = await service.enableTwoFactor(user, '123456');
      expect(result).toEqual({ backupCodes: ['a1b2-c3d4', 'e5f6-g7h8'] });
      expect(users.enableTwoFactor).toHaveBeenCalledWith(user.id, ['hash1', 'hash2']);
    });
  });

  describe('disableTwoFactor', () => {
    it('throw BadRequestException si pas enabled', async () => {
      const user = mkUser({ isTwoFactorEnabled: false });
      await expect(service.disableTwoFactor(user, 'pw')).rejects.toThrow(BadRequestException);
    });

    it('throw UnauthorizedException si password invalide', async () => {
      const user = mkUser({ isTwoFactorEnabled: true });
      password.verify.mockResolvedValue(false);
      await expect(service.disableTwoFactor(user, 'bad')).rejects.toThrow(UnauthorizedException);
    });

    it('reset 2FA si password valide', async () => {
      const user = mkUser({ isTwoFactorEnabled: true });
      password.verify.mockResolvedValue(true);
      await service.disableTwoFactor(user, 'good');
      expect(users.disableTwoFactor).toHaveBeenCalledWith(user.id);
    });
  });

  describe('regenerateBackupCodes', () => {
    it('throw BadRequestException si 2FA pas enabled', async () => {
      const user = mkUser({ isTwoFactorEnabled: false });
      await expect(service.regenerateBackupCodes(user, 'pw')).rejects.toThrow(BadRequestException);
    });

    it('throw UnauthorizedException si password invalide', async () => {
      const user = mkUser({ isTwoFactorEnabled: true });
      password.verify.mockResolvedValue(false);
      await expect(service.regenerateBackupCodes(user, 'bad')).rejects.toThrow(UnauthorizedException);
    });

    it('regénère et persiste les nouveaux codes', async () => {
      const user = mkUser({ isTwoFactorEnabled: true });
      password.verify.mockResolvedValue(true);
      twoFactor.generateBackupCodes.mockReturnValue(['new1', 'new2']);
      twoFactor.hashBackupCodes.mockResolvedValue(['hashN1', 'hashN2']);
      const result = await service.regenerateBackupCodes(user, 'good');
      expect(result).toEqual({ backupCodes: ['new1', 'new2'] });
      expect(users.replaceBackupCodes).toHaveBeenCalledWith(user.id, ['hashN1', 'hashN2']);
    });
  });
});
