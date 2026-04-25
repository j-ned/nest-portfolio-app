import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import ms from 'ms';
import { AuthService } from './auth.service';
import { AppConfigService } from '../config/app-config.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser } from './current-user.decorator';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { TwoFactorVerifyDto } from './dto/two-factor-verify.dto';
import { TwoFactorEnableDto } from './dto/two-factor-enable.dto';
import { TwoFactorDisableDto } from './dto/two-factor-disable.dto';
import type { User } from '../database/schema/users';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly cfg: AppConfigService,
  ) {}

  // ===== Public endpoints (no JwtAuthGuard) =====

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Login with email + password (returns challenge if 2FA enabled)',
  })
  @ApiResponse({
    status: 200,
    description: 'Authenticated (cookie set) OR 2FA challenge required',
  })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.login(dto.email, dto.password);
    if (result.kind === 'authenticated') {
      this.setAuthCookie(res, result.token);
      return { user: result.user };
    }
    return { requiresTwoFactor: true, challengeToken: result.challengeToken };
  }

  @Post('2fa/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Complete 2FA login with TOTP code or backup code' })
  @ApiResponse({ status: 200, description: 'Authenticated (cookie set)' })
  @ApiResponse({
    status: 401,
    description: 'Invalid challenge / code / backup code',
  })
  async verifyTwoFactor(
    @Body() dto: TwoFactorVerifyDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.verifyTwoFactor(dto.challengeToken, {
      code: dto.code,
      backupCode: dto.backupCode,
    });
    this.setAuthCookie(res, result.token);
    return { user: result.user };
  }

  // ===== Protected endpoints =====

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Logout (clears auth cookie)' })
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie('token', { httpOnly: true, sameSite: 'lax', path: '/' });
    return { ok: true };
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current authenticated user' })
  me(@CurrentUser() user: User) {
    return {
      id: user.id,
      email: user.email,
      isTwoFactorEnabled: user.isTwoFactorEnabled,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Change the current user password' })
  async changePassword(
    @CurrentUser() user: User,
    @Body() dto: ChangePasswordDto,
  ) {
    await this.auth.changePassword(user, dto.currentPassword, dto.newPassword);
    return { ok: true };
  }

  @UseGuards(JwtAuthGuard)
  @Post('2fa/generate')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Generate a 2FA TOTP secret + QR code (does not enable yet)',
  })
  async generateTwoFactor(@CurrentUser() user: User) {
    return this.auth.generateTwoFactorSecret(user);
  }

  @UseGuards(JwtAuthGuard)
  @Post('2fa/enable')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Verify a TOTP code and enable 2FA (returns 10 one-time backup codes)',
  })
  async enableTwoFactor(
    @CurrentUser() user: User,
    @Body() dto: TwoFactorEnableDto,
  ) {
    return this.auth.enableTwoFactor(user, dto.code);
  }

  @UseGuards(JwtAuthGuard)
  @Post('2fa/disable')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Disable 2FA (requires current password)' })
  async disableTwoFactor(
    @CurrentUser() user: User,
    @Body() dto: TwoFactorDisableDto,
  ) {
    await this.auth.disableTwoFactor(user, dto.password);
    return { ok: true };
  }

  @UseGuards(JwtAuthGuard)
  @Post('2fa/regenerate-backup-codes')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Regenerate the 10 backup codes (requires current password)',
  })
  async regenerateBackupCodes(
    @CurrentUser() user: User,
    @Body() dto: TwoFactorDisableDto,
  ) {
    return this.auth.regenerateBackupCodes(user, dto.password);
  }

  // ===== Helpers =====

  private setAuthCookie(res: Response, token: string): void {
    res.cookie('token', token, {
      httpOnly: true,
      secure: this.cfg.isProduction,
      sameSite: 'lax',

      maxAge: (ms as unknown as (s: string) => number)(this.cfg.jwtExpiresIn),
      path: '/',
    });
  }
}
