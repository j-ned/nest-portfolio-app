import { Injectable } from '@nestjs/common';
import { generateSecret, generateURI, verifySync } from 'otplib';
import * as QRCode from 'qrcode';
import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { AppConfigService } from '../config/app-config.service';

@Injectable()
export class TwoFactorService {
  constructor(private readonly cfg: AppConfigService) {}

  generateSecret(): string {
    return generateSecret();
  }

  async generateQrCodeDataUrl(email: string, secret: string): Promise<string> {
    const otpauthUrl = generateURI({
      issuer: this.cfg.totpAppName,
      label: email,
      secret,
    });
    return QRCode.toDataURL(otpauthUrl);
  }

  verifyTotpCode(secret: string, code: string): boolean {
    const result = verifySync({ secret, token: code });
    return result.valid;
  }

  generateBackupCodes(count = 10): string[] {
    const codes: string[] = [];
    while (codes.length < count) {
      const code = this.randomCode();
      if (!codes.includes(code)) codes.push(code);
    }
    return codes;
  }

  async hashBackupCodes(codes: string[]): Promise<string[]> {
    return Promise.all(codes.map((c) => argon2.hash(c)));
  }

  async findMatchingBackupCode(
    plain: string,
    hashes: string[],
  ): Promise<string | null> {
    if (hashes.length === 0) return null;
    // Vérifie en parallèle ; renvoie le premier hash qui matche.
    // Promise.any rejette avec AggregateError si TOUS rejettent.
    try {
      return await Promise.any(
        hashes.map(async (hash) => {
          const ok = await argon2.verify(hash, plain).catch(() => false);
          if (!ok) throw new Error('no match');
          return hash;
        }),
      );
    } catch {
      return null;
    }
  }

  private randomCode(): string {
    // 8 caractères hex (4 bytes) → format 'xxxx-xxxx'
    const bytes = randomBytes(4).toString('hex'); // 8 chars hex
    return `${bytes.slice(0, 4)}-${bytes.slice(4, 8)}`;
  }
}
