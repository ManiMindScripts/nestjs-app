import {
  Global,
  Inject,
  Logger,
  Module,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { RedisConfig } from '../../config/redis.config';

export const REDIS_CLIENT = 'REDIS_CLIENT';

const REDIS_SHUTDOWN_TIMEOUT_MS = 5_000;
const REDIS_MAX_RECONNECT_ATTEMPTS = 20;
const REDIS_RECONNECT_MAX_DELAY_MS = 2_000;

class RedisConnectionShutdown implements OnApplicationShutdown {
  private readonly logger = new Logger(RedisConnectionShutdown.name);

  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    if (this.client.status !== 'ready') {
      this.client.disconnect();
      return;
    }

    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.client.quit(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Redis quit timed out')),
            REDIS_SHUTDOWN_TIMEOUT_MS,
          );
        }),
      ]);
    } catch (error) {
      this.logger.warn(
        'Forcing Redis disconnect after quit timeout',
        String(error),
      );
      this.client.disconnect();
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }
}

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (configService: ConfigService): Redis => {
        const redisConfig = configService.getOrThrow<RedisConfig>('redis');

        return new Redis({
          host: redisConfig.host,
          port: redisConfig.port,
          password: redisConfig.password || undefined,
          maxRetriesPerRequest: 2,
          enableReadyCheck: true,
          retryStrategy: (times: number): number | null => {
            if (times > REDIS_MAX_RECONNECT_ATTEMPTS) {
              return null;
            }
            return Math.min(times * 100, REDIS_RECONNECT_MAX_DELAY_MS);
          },
        });
      },
    },
    RedisConnectionShutdown,
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
