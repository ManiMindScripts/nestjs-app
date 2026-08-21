import { Logger } from '@nestjs/common';
import { ThrottlerStorageService } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import type { Redis } from 'ioredis';
import { ResilientThrottlerStorage } from './resilient-throttler-storage';

jest.mock('@nest-lab/throttler-storage-redis', () => ({
  ThrottlerStorageRedisService: jest.fn(),
}));

const redisIncrement = jest.fn();
const redisOnModuleDestroy = jest.fn();
const constructRedisStorage =
  ThrottlerStorageRedisService as unknown as jest.Mock;

describe('ResilientThrottlerStorage', () => {
  let storage: ResilientThrottlerStorage;
  let warnSpy: jest.SpyInstance;
  let logSpy: jest.SpyInstance;
  const incrementArgs = ['key', 60, 100, 60, 'default'] as const;

  beforeEach(() => {
    constructRedisStorage.mockImplementation(() => ({
      increment: redisIncrement,
      onModuleDestroy: redisOnModuleDestroy,
    }));
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    storage = new ResilientThrottlerStorage({} as Redis);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('delegates increments to the redis storage', async () => {
    const record = { totalHits: 1 };
    redisIncrement.mockResolvedValueOnce(record);

    await expect(storage.increment(...incrementArgs)).resolves.toBe(record);
    expect(redisIncrement).toHaveBeenCalledWith(...incrementArgs);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('falls back to in-memory storage when redis fails', async () => {
    redisIncrement.mockRejectedValueOnce(new Error('redis down'));

    const record = await storage.increment(...incrementArgs);

    expect(record.totalHits).toBe(1);
    expect(record.isBlocked).toBe(false);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect((warnSpy.mock.calls as string[][])[0][0]).toContain(
      'in-memory fallback',
    );
  });

  it('keeps using the fallback without repeating the warning until redis recovers', async () => {
    redisIncrement
      .mockRejectedValueOnce(new Error('redis down'))
      .mockRejectedValueOnce(new Error('redis down'))
      .mockResolvedValueOnce({ totalHits: 1 });

    await storage.increment(...incrementArgs);
    await storage.increment(...incrementArgs);
    expect(warnSpy).toHaveBeenCalledTimes(1);

    await storage.increment(...incrementArgs);
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect((logSpy.mock.calls as string[][])[0][0]).toContain('recovered');

    redisIncrement.mockReset();
    redisIncrement.mockRejectedValueOnce(new Error('redis down'));
    await storage.increment(...incrementArgs);
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });

  it('shuts down both storages', () => {
    const inMemoryShutdown = jest
      .spyOn(ThrottlerStorageService.prototype, 'onApplicationShutdown')
      .mockImplementation(() => {});

    storage.onApplicationShutdown();

    expect(inMemoryShutdown).toHaveBeenCalled();
    expect(redisOnModuleDestroy).toHaveBeenCalled();
  });
});
