import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { PasswordService } from './password.service';
import { TwoFactorService } from './two-factor.service';
import { AppConfigService } from '../config/app-config.service';
import type { User } from '../database/schema/users';

interface JwtPayload {
  sub: string;
  scope?: string;
}

export type LoginResult =
  | { kind: 'authenticated'; token: string; user: PublicUser }
  | { kind: 'challenge'; challengeToken: string };

export interface PublicUser {
  id: string;
  email: string;
  isTwoFactorEnabled: boolean;
}

function publicUser(u: User): PublicUser {
  return { id: u.id, email: u.email, isTwoFactorEnabled: u.isTwoFactorEnabled };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly password: PasswordService,
    private readonly twoFactor: TwoFactorService,
    private readonly jwt: JwtService,

    private readonly cfg: AppConfigService,
  ) {}

  async login(email: string, plainPassword: string): Promise<LoginResult> {
    const user = await this.users.findByEmail(email);
    if (!user) throw new UnauthorizedException('Invalid credentials');
    const ok = await this.password.verify(plainPassword, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    if (user.isTwoFactorEnabled) {
      const challengeToken = this.jwt.sign(
        { sub: user.id, scope: '2fa-challenge' },
        { expiresIn: '5m' },
      );
      return { kind: 'challenge', challengeToken };
    }

    const token = this.jwt.sign({ sub: user.id });
    return { kind: 'authenticated', token, user: publicUser(user) };
  }

  async verifyTwoFactor(
    challengeToken: string,
    creds: { code?: string; backupCode?: string },
  ): Promise<{ token: string; user: PublicUser }> {
    let payload: JwtPayload;
    try {
      payload = this.jwt.verify<JwtPayload>(challengeToken);
    } catch {
      throw new UnauthorizedException('Invalid challenge token');
    }
    if (payload.scope !== '2fa-challenge') {
      throw new UnauthorizedException('Invalid challenge token');
    }
    const user = await this.users.findById(payload.sub);
    if (!user || !user.isTwoFactorEnabled || !user.twoFactorSecret) {
      throw new UnauthorizedException('Invalid challenge token');
    }

    if (creds.code) {
      if (!this.twoFactor.verifyTotpCode(user.twoFactorSecret, creds.code)) {
        throw new UnauthorizedException('Invalid 2FA code');
      }
    } else if (creds.backupCode) {
      const matchHash = await this.twoFactor.findMatchingBackupCode(
        creds.backupCode,
        user.twoFactorBackupCodesHash ?? [],
      );
      if (!matchHash) throw new UnauthorizedException('Invalid backup code');
      await this.users.consumeBackupCode(user.id, matchHash);
    } else {
      throw new UnauthorizedException('Either code or backupCode is required');
    }

    const token = this.jwt.sign({ sub: user.id });
    return { token, user: publicUser(user) };
  }

  async changePassword(
    user: User,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const ok = await this.password.verify(currentPassword, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid current password');
    const newHash = await this.password.hash(newPassword);
    await this.users.updatePassword(user.id, newHash);
  }

  async generateTwoFactorSecret(
    user: User,
  ): Promise<{ secret: string; qrCodeDataUrl: string }> {
    if (user.isTwoFactorEnabled) {
      throw new BadRequestException('2FA is already enabled');
    }
    const secret = this.twoFactor.generateSecret();
    const qrCodeDataUrl = await this.twoFactor.generateQrCodeDataUrl(
      user.email,
      secret,
    );
    await this.users.updateTwoFactorSecret(user.id, secret);
    return { secret, qrCodeDataUrl };
  }

  async enableTwoFactor(
    user: User,
    code: string,
  ): Promise<{ backupCodes: string[] }> {
    if (!user.twoFactorSecret) {
      throw new BadRequestException(
        'Generate a 2FA secret first via /auth/2fa/generate',
      );
    }
    if (!this.twoFactor.verifyTotpCode(user.twoFactorSecret, code)) {
      throw new UnauthorizedException('Invalid 2FA code');
    }
    const backupCodes = this.twoFactor.generateBackupCodes();
    const hashes = await this.twoFactor.hashBackupCodes(backupCodes);
    await this.users.enableTwoFactor(user.id, hashes);
    return { backupCodes };
  }

  async disableTwoFactor(user: User, password: string): Promise<void> {
    if (!user.isTwoFactorEnabled) {
      throw new BadRequestException('2FA is not enabled');
    }
    const ok = await this.password.verify(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid password');
    await this.users.disableTwoFactor(user.id);
  }

  async regenerateBackupCodes(
    user: User,
    password: string,
  ): Promise<{ backupCodes: string[] }> {
    if (!user.isTwoFactorEnabled) {
      throw new BadRequestException('2FA is not enabled');
    }
    const ok = await this.password.verify(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid password');
    const backupCodes = this.twoFactor.generateBackupCodes();
    const hashes = await this.twoFactor.hashBackupCodes(backupCodes);
    await this.users.replaceBackupCodes(user.id, hashes);
    return { backupCodes };
  }
}
