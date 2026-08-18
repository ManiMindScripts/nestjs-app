import { ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  const reflector = { getAllAndOverride: jest.fn() };
  const context = {
    getHandler: () => ({}),
    getClass: () => class {},
  } as unknown as ExecutionContext;

  beforeEach(() => {
    reflector.getAllAndOverride.mockReset();
    guard = new JwtAuthGuard(reflector as never);
  });

  it('lets @Public() routes through without authentication', () => {
    reflector.getAllAndOverride.mockReturnValue(true);

    expect(guard.canActivate(context)).toBe(true);
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith('isPublic', [
      expect.anything(),
      expect.anything(),
    ]);
  });

  it('delegates to the passport strategy on protected routes', () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    const passportBase = AuthGuard('jwt');
    const passportSpy = jest
      .spyOn(passportBase.prototype, 'canActivate')
      .mockReturnValue(true);

    expect(guard.canActivate(context)).toBe(true);
    expect(passportSpy).toHaveBeenCalled();

    passportSpy.mockRestore();
  });
});
