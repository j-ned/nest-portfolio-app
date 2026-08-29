import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';
import type { AppConfigService } from '../config/app-config.service';
import type { UsersService } from '../users/users.service';
import type { User } from '../database/schema';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  let users: { findById: jest.Mock };

  const mkUser = (overrides: Partial<User> = {}): User => ({
    id: 'user-123',
    email: 'admin@example.com',
    passwordHash: '$argon2id$...',
    isTwoFactorEnabled: false,
    twoFactorSecret: null,
    twoFactorBackupCodesHash: null,
    tokenVersion: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  beforeEach(() => {
    users = { findById: jest.fn() };
    const cfg = { jwtSecret: 'x'.repeat(32) } as AppConfigService;
    strategy = new JwtStrategy(cfg, users as unknown as UsersService);
  });

  it('retourne le user quand le tokenVersion correspond', async () => {
    users.findById.mockResolvedValue(mkUser({ tokenVersion: 2 }));
    const result = await strategy.validate({
      sub: 'user-123',
      tokenVersion: 2,
    });
    expect(result.id).toBe('user-123');
  });

  it('rejette un token dont le tokenVersion est révoqué (password changé depuis)', async () => {
    users.findById.mockResolvedValue(mkUser({ tokenVersion: 3 }));
    await expect(
      strategy.validate({ sub: 'user-123', tokenVersion: 2 }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it("rejette si le user n'existe plus", async () => {
    users.findById.mockResolvedValue(null);
    await expect(
      strategy.validate({ sub: 'user-123', tokenVersion: 0 }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejette un challenge token 2FA (scope non authentifiant)', async () => {
    await expect(
      strategy.validate({ sub: 'user-123', scope: '2fa-challenge' }),
    ).rejects.toThrow(UnauthorizedException);
    expect(users.findById).not.toHaveBeenCalled();
  });
});
