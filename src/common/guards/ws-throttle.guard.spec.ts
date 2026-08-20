import { ExecutionContext } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { WsThrottleGuard } from './ws-throttle.guard';

describe('WsThrottleGuard', () => {
  const reflector = { getAllAndOverride: jest.fn() };
  let guard: WsThrottleGuard;
  let socket: { data: Record<string, unknown> };

  const makeContext = (eventName: string): ExecutionContext =>
    ({
      getHandler: () => ({}),
      getClass: () => class {},
      switchToWs: () => ({
        getClient: () => socket,
        getPattern: () => eventName,
      }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    reflector.getAllAndOverride.mockReset();
    socket = { data: {} };
    guard = new WsThrottleGuard(reflector as never);
  });

  it('allows events without throttle metadata', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);

    expect(guard.canActivate(makeContext('ping'))).toBe(true);
  });

  it('counts within the window and throws once the limit is exceeded', () => {
    reflector.getAllAndOverride.mockReturnValue({ limit: 2, windowMs: 1000 });

    expect(guard.canActivate(makeContext('event'))).toBe(true);
    expect(guard.canActivate(makeContext('event'))).toBe(true);
    expect(() => guard.canActivate(makeContext('event'))).toThrow(WsException);
  });

  it('resets the counter after the window elapses', () => {
    reflector.getAllAndOverride.mockReturnValue({ limit: 1, windowMs: 1000 });

    expect(guard.canActivate(makeContext('event'))).toBe(true);
    expect(() => guard.canActivate(makeContext('event'))).toThrow(WsException);

    const state = (
      socket.data as { _wsThrottle: Record<string, { resetAt: number }> }
    )._wsThrottle;
    state.event.resetAt = Date.now() - 1;

    expect(guard.canActivate(makeContext('event'))).toBe(true);
  });

  it('tracks distinct events independently', () => {
    reflector.getAllAndOverride.mockReturnValue({ limit: 1, windowMs: 1000 });

    expect(guard.canActivate(makeContext('a'))).toBe(true);
    expect(guard.canActivate(makeContext('b'))).toBe(true);
    expect(() => guard.canActivate(makeContext('a'))).toThrow(WsException);
  });
});
