import { ConfigService } from '@nestjs/config';
import type { ConnectionOptions } from 'bullmq';
import { RedisConfig } from '../../../config/redis.config';
import type { AppConfig } from '../../../config/app.config';

// BullMQ workers issue blocking commands, which ioredis refuses to retry
// (maxRetriesPerRequest must be null there). The producer side has no such
// constraint - and because queue.add() sits inside the request path, it gets
// aggressive timeouts instead so a slow/down Redis rejects fast into
// MailService's catch-log-resolve handler rather than hanging the request.
//
// Plain option objects are passed to BullMQ (not pre-built ioredis clients)
// so that BullMQ owns both connections and tears them down fully on
// queue.close()/worker.close().
const PRODUCER_MAX_RETRIES_PER_REQUEST = 1;

export const MAIL_CONNECT_TIMEOUT_MS = 2_000;

export function buildMailConnection(
  configService: ConfigService,
  role: 'producer' | 'worker',
): ConnectionOptions {
  const redis = configService.getOrThrow<RedisConfig>('redis');
  const app = configService.getOrThrow<AppConfig>('app');

  return {
    host: redis.host,
    port: redis.port,
    password: redis.password || undefined,
    connectTimeout: MAIL_CONNECT_TIMEOUT_MS,
    enableReadyCheck: true,
    maxRetriesPerRequest:
      role === 'producer' ? PRODUCER_MAX_RETRIES_PER_REQUEST : null,
    // Keep the two connections distinguishable in Redis CLIENT LIST output.
    connectionName: `${app.nodeEnv}:mail-queue-${role}`,
  };
}
