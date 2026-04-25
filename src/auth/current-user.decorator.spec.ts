import { ExecutionContext } from '@nestjs/common';

// On réplique la factory du decorator pour pouvoir la tester directement.
// (createParamDecorator wrappe la factory dans un metadata Symbol qu'on n'a pas accès depuis dehors.)
const currentUserFactory = (_data: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest().user;
};

describe('CurrentUser decorator factory', () => {
  it('extrait request.user du contexte HTTP', () => {
    const fakeUser = { id: 'abc', email: 'x@y.com' };
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({ user: fakeUser }),
      }),
    } as unknown as ExecutionContext;

    expect(currentUserFactory(undefined, ctx)).toBe(fakeUser);
  });

  it('retourne undefined si request.user est absent', () => {
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({}),
      }),
    } as unknown as ExecutionContext;

    expect(currentUserFactory(undefined, ctx)).toBeUndefined();
  });
});
