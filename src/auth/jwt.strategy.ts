import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Request } from 'express';
import { AppConfigService } from '../config/app-config.service';
import { UsersService } from '../users/users.service';
import type { User } from '../database/schema/users';

interface JwtPayload {
  sub: string;
  scope?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    cfg: AppConfigService,
    private readonly users: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req: Request) =>
          (req?.cookies as Record<string, string> | undefined)?.token ?? null,
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      secretOrKey: cfg.jwtSecret,
    });
  }

  async validate(payload: JwtPayload): Promise<User> {
    if (payload.scope === '2fa-challenge') {
      throw new UnauthorizedException(
        'Challenge token cannot be used for authentication',
      );
    }
    const user = await this.users.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }
    return user;
  }
}
