import { Logger, OnApplicationShutdown } from '@nestjs/common';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { Redis } from 'ioredis';

export class ResilientThrottlerStorage
  implements ThrottlerStorage, OnApplicationShutdown
{
  private readonly logger = new Logger(ResilientThrottlerStorage.name);
  private readonly redisStorage: ThrottlerStorageRedisService;
  private readonly inMemoryStorage = new ThrottlerStorageService();
  private usingFallback = false;

  constructor(redisClient: Redis) {
    this.redisStorage = new ThrottlerStorageRedisService(redisClient);
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    try {
      const record = await this.redisStorage.increment(
        key,
        ttl,
        limit,
        blockDuration,
        throttlerName,
      );
      if (this.usingFallback) {
        this.usingFallback = false;
        this.logger.log('Redis throttling storage recovered');
      }
      return record;
    } catch (error) {
      if (!this.usingFallback) {
        this.usingFallback = true;
        this.logger.warn(
          `Redis throttling storage unavailable (${String(error)}); using in-memory fallback`,
        );
      }
      return this.inMemoryStorage.increment(
        key,
        ttl,
        limit,
        blockDuration,
        throttlerName,
      );
    }
  }

  onApplicationShutdown(): void {
    this.inMemoryStorage.onApplicationShutdown();
    this.redisStorage.onModuleDestroy();
  }
}
