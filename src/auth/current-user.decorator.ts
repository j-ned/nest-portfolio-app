import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { User } from '../database/schema/users';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): User => {
    return ctx.switchToHttp().getRequest<{ user: User }>().user;
  },
);
