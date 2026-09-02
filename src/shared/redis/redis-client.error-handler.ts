import { Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';

const logger = new Logger('Redis');

/**
 * Attaches a resilient error listener to an ioredis client.
 *
 * ioredis emits an `'error'` event for connection failures and protocol
 * errors. If no listener is attached, Node throws inside the event loop and
 * takes the whole process down. That is strictly worse than Redis being
 * unavailable: an outage trips the graceful fallbacks (in-memory throttler
 * storage, degraded IO adapter, queue restart-survival), whereas an uncaught
 * `'error'` event skips all of them and crashes the process outright. Every
 * client this app owns must register a listener that logs instead of crashing.
 */
export function attachRedisErrorHandler(client: Redis, context: string): void {
  client.on('error', (error: Error) => {
    logger.error(`Redis (${context}) error`, error.stack ?? String(error));
  });
}
