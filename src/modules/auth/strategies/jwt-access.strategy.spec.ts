import { ConfigService } from '@nestjs/config';
import { JwtAccessStrategy, JwtPayload } from './jwt-access.strategy';

describe('JwtAccessStrategy', () => {
  const config = {
    getOrThrow: jest.fn((key: string) => {
      if (key === 'jwt') {
        return { accessSecret: 'a-very-long-secret-that-is-at-least-32-chars' };
      }
      throw new Error(`Unexpected key: ${key}`);
    }),
  } as unknown as ConfigService;
  const identity = { findActiveUserById: jest.fn() };

  beforeEach(() => {
    identity.findActiveUserById.mockReset();
  });

  const createStrategy = (): JwtAccessStrategy =>
    new JwtAccessStrategy(config, identity as never);

  it('returns null for a payload without a sub', async () => {
    const strategy = createStrategy();
    await expect(strategy.validate({} as JwtPayload)).resolves.toBeNull();
    expect(identity.findActiveUserById).not.toHaveBeenCalled();
  });

  it('resolves the active user via the shared identity service', async () => {
    const user = { id: 'user-1' };
    identity.findActiveUserById.mockResolvedValue(user);
    const strategy = createStrategy();

    await expect(
      strategy.validate({ sub: 'user-1', email: 'a@e.com' }),
    ).resolves.toBe(user);
    expect(identity.findActiveUserById).toHaveBeenCalledWith('user-1');
  });
});
