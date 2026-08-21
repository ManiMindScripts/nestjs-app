import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerModuleOptions, ThrottlerStorage } from '@nestjs/throttler';
import { UserThrottlerGuard } from './user-throttler.guard';

const createGuard = (): {
  guard: UserThrottlerGuard;
  trackedKeys: string[];
  reflector: { getAllAndOverride: jest.Mock };
} => {
  const trackedKeys: string[] = [];
  const increment = jest.fn((key: string): Promise<unknown> => {
    trackedKeys.push(key);
    return Promise.resolve({
      totalHits: 1,
      timeToExpire: 60_000,
      isBlocked: false,
      timeToBlockExpire: 0,
    });
  });
  const reflector = { getAllAndOverride: jest.fn().mockReturnValue(undefined) };
  const options = [{ ttl: 60_000, limit: 100 }] as ThrottlerModuleOptions;
  const storage = { increment } as unknown as ThrottlerStorage;
  const guard = new UserThrottlerGuard(
    options,
    storage,
    reflector as unknown as Reflector,
  );
  return { guard, trackedKeys, reflector };
};

const createContext = (user?: { id: string }): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ user, ip: '203.0.113.9' }),
      getResponse: () => ({ header: jest.fn() }),
    }),
    getHandler: () => () => undefined,
    getClass: () => class TestController {},
  }) as unknown as ExecutionContext;

describe('UserThrottlerGuard', () => {
  it('skips requests without an authenticated user', async () => {
    const { guard, trackedKeys } = createGuard();
    await guard.onModuleInit();

    await expect(guard.canActivate(createContext())).resolves.toBe(true);
    expect(trackedKeys).toHaveLength(0);
  });

  it('keys the bucket by user id for authenticated requests', async () => {
    const { guard, trackedKeys } = createGuard();
    await guard.onModuleInit();

    const context = createContext({ id: 'user-1' });
    await guard.canActivate(context);
    await guard.canActivate(context);
    await guard.canActivate(createContext({ id: 'user-2' }));

    expect(trackedKeys).toHaveLength(3);
    expect(trackedKeys[0]).toBe(trackedKeys[1]);
    expect(trackedKeys[2]).not.toBe(trackedKeys[0]);
  });

  it('honours skip metadata before touching storage', async () => {
    const { guard, trackedKeys, reflector } = createGuard();
    reflector.getAllAndOverride.mockReturnValueOnce(true);
    await guard.onModuleInit();

    await expect(
      guard.canActivate(createContext({ id: 'user-1' })),
    ).resolves.toBe(true);
    expect(trackedKeys).toHaveLength(0);
  });
});
