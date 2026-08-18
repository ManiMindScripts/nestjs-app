import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { RedisConfig } from '../../config/redis.config';

export const REDIS_CLIENT = 'REDIS_CLIENT';

class RedisConnectionShutdown implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    await this.client.quit();
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
        });
      },
    },
    RedisConnectionShutdown,
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
