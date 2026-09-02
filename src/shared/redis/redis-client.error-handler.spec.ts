import { EventEmitter } from 'node:events';
import { Logger } from '@nestjs/common';
import { attachRedisErrorHandler } from './redis-client.error-handler';

class FakeRedis extends EventEmitter {
  status = 'ready';
}

describe('attachRedisErrorHandler', () => {
  let errorSpy: jest.SpyInstance;
  let client: FakeRedis;

  beforeEach(() => {
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    client = new FakeRedis();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('registers an error listener on the client', () => {
    attachRedisErrorHandler(client as never, 'main');
    expect(client.listenerCount('error')).toBe(1);
  });

  it('logs instead of throwing when the client emits an error', () => {
    attachRedisErrorHandler(client as never, 'main');

    // If the listener threw, this emit would reject and fail the test.
    expect(() =>
      client.emit('error', new Error('connection lost')),
    ).not.toThrow();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Redis (main) error'),
      expect.stringContaining('connection lost'),
    );
  });

  it('does not crash when the error object has no stack', () => {
    attachRedisErrorHandler(client as never, 'io-adapter-pub');

    expect(() => client.emit('error', new Error('boom'))).not.toThrow();
    expect(errorSpy).toHaveBeenCalled();
  });
});
