import { Server } from 'socket.io';
import { RealtimeAdapterStatus } from './realtime-adapter.status';
import { RedisIoAdapter } from './redis-io.adapter';

type ClientMock = Record<string, jest.Mock> & { status: string };

describe('RedisIoAdapter', () => {
  let adapterStatus: RealtimeAdapterStatus;
  let redisClient: ClientMock;
  let pubClient: ClientMock;
  let subClient: ClientMock;

  const makeClient = (status = 'connecting'): ClientMock => ({
    pSubscribe: jest.fn(),
    subscribe: jest.fn(),
    pUnsubscribe: jest.fn(),
    unsubscribe: jest.fn(),
    publish: jest.fn(),
    on: jest.fn(),
    once: jest.fn(),
    removeListener: jest.fn(),
    off: jest.fn(),
    unref: jest.fn(),
    disconnect: jest.fn(),
    ping: jest.fn().mockResolvedValue('PONG'),
    duplicate: jest.fn(),
    status,
  });

  const app = (): { get: (token: unknown) => unknown } => ({
    get: (token: unknown) => {
      if (token === 'REDIS_CLIENT') {
        return redisClient;
      }
      return adapterStatus;
    },
  });

  beforeEach(() => {
    adapterStatus = new RealtimeAdapterStatus();
    pubClient = makeClient();
    subClient = makeClient();
    pubClient.duplicate.mockReturnValue(subClient);
    redisClient = makeClient();
    redisClient.duplicate.mockReturnValue(pubClient);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const createAdapter = (): RedisIoAdapter =>
    new RedisIoAdapter(app() as never, {
      origin: ['http://localhost:5173'],
      credentials: true,
    });

  it('attaches the redis adapter when both clients are reachable', async () => {
    const adapter = createAdapter();
    const server = new Server();

    await adapter.attachRedisAdapter(server);

    expect(adapterStatus.isDegraded).toBe(false);
    expect(adapterStatus.reason).toBeNull();
    expect(subClient.disconnect).not.toHaveBeenCalled();
    expect(redisClient.once).not.toHaveBeenCalled();
  });

  it('degrades, disconnects the clients and schedules a retry when redis is unreachable', async () => {
    pubClient.ping.mockRejectedValue(new Error('ECONNREFUSED'));
    subClient.ping.mockRejectedValue(new Error('ECONNREFUSED'));
    const adapter = createAdapter();
    const server = new Server();

    await adapter.attachRedisAdapter(server);

    expect(adapterStatus.isDegraded).toBe(true);
    expect(adapterStatus.reason).toBe('ECONNREFUSED');
    expect(adapterStatus.since).toBeDefined();
    expect(pubClient.disconnect).toHaveBeenCalled();
    expect(subClient.disconnect).toHaveBeenCalled();
    expect(redisClient.once).toHaveBeenCalledWith(
      'ready',
      expect.any(Function),
    );
  });

  it('schedules a short retry instead of waiting for ready when already connected', async () => {
    jest.useFakeTimers();
    redisClient.status = 'ready';
    pubClient.ping.mockRejectedValue(new Error('ECONNREFUSED'));
    subClient.ping.mockRejectedValue(new Error('ECONNREFUSED'));
    const adapter = createAdapter();
    const server = new Server();

    await adapter.attachRedisAdapter(server);

    expect(adapterStatus.isDegraded).toBe(true);
    expect(redisClient.once).not.toHaveBeenCalled();
    // Exactly one pending timer: the 500ms retry (the ping race timeout is
    // cleared on failure).
    expect(jest.getTimerCount()).toBe(1);
  });
});
