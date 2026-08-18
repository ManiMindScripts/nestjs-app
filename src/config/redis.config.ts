import { registerAs } from '@nestjs/config';

export interface RedisConfig {
  host: string;
  port: number;
  password: string;
}

export const redisConfig = registerAs('redis', (): RedisConfig => {
  const env = process.env;

  return {
    host: env.REDIS_HOST ?? 'localhost',
    port: parseInt(env.REDIS_PORT ?? '6379', 10),
    password: env.REDIS_PASSWORD ?? '',
  };
});
