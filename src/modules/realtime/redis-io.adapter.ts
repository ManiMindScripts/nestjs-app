import { INestApplicationContext, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import type { Server, ServerOptions, Socket } from 'socket.io';
import type { CorsOptions } from '../../config/cors.config';
import { REDIS_CLIENT } from '../../shared/redis/redis.module';
import { RealtimeAdapterStatus } from './realtime-adapter.status';

const ADAPTER_PING_TIMEOUT_MS = 2_000;
const CONNECT_RATE_WINDOW_SECONDS = 60;

export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private readonly app: INestApplicationContext;
  private readonly redisClient: Redis;
  private readonly adapterStatus: RealtimeAdapterStatus;
  private redisAttached = false;

  constructor(
    app: INestApplicationContext,
    private readonly corsOptions: CorsOptions,
  ) {
    super(app);
    this.app = app;
    this.redisClient = app.get<Redis>(REDIS_CLIENT);
    this.adapterStatus = app.get<RealtimeAdapterStatus>(RealtimeAdapterStatus);
  }

  createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, {
      ...options,
      cors: this.corsOptions,
    }) as Server;
    this.attachConnectRateLimit(server);
    void this.attachRedisAdapter(server);
    return server;
  }

  async attachRedisAdapter(server: Server): Promise<void> {
    if (this.redisAttached) {
      return;
    }

    let pubClient: Redis;
    let subClient: Redis;
    try {
      pubClient = this.redisClient.duplicate();
      subClient = pubClient.duplicate();
    } catch (error) {
      this.degrade(server, error);
      return;
    }

    try {
      await Promise.race([
        Promise.all([pubClient.ping(), subClient.ping()]),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('Redis adapter ping timed out')),
            ADAPTER_PING_TIMEOUT_MS,
          ),
        ),
      ]);
    } catch (error) {
      pubClient.disconnect();
      subClient.disconnect();
      this.degrade(server, error);
      return;
    }

    server.adapter(createAdapter(pubClient, subClient));
    this.redisAttached = true;
    this.adapterStatus.markHealthy();
    this.logger.log('Redis IO adapter attached');
  }

  private attachConnectRateLimit(server: Server): void {
    const configService = this.app.get<ConfigService>(ConfigService);
    const limit = configService.getOrThrow<number>('WS_CONNECT_RATE_LIMIT');

    server.use((socket: Socket, next: (err?: Error) => void): void => {
      void this.checkConnectRateLimit(socket, next, limit);
    });
  }

  private async checkConnectRateLimit(
    socket: Socket,
    next: (err?: Error) => void,
    limit: number,
  ): Promise<void> {
    try {
      const key = `ws:connect:${socket.handshake.address}`;
      const current = await this.redisClient.incr(key);
      if (current === 1) {
        await this.redisClient.expire(key, CONNECT_RATE_WINDOW_SECONDS);
      }
      if (current > limit) {
        next(new Error('Connection rate limit exceeded'));
        return;
      }
      next();
    } catch (error) {
      // Redis-down must not take down the socket layer: log and allow.
      this.logger.warn(
        'WS connect rate limit check failed; allowing connection',
        error instanceof Error ? error.message : String(error),
      );
      next();
    }
  }

  private degrade(server: Server, error: unknown): void {
    const reason = error instanceof Error ? error.message : String(error);
    this.adapterStatus.markDegraded(reason);
    this.logger.error(
      `Redis IO adapter degraded; using in-memory adapter. Cross-instance events will not work. Reason: ${reason}`,
    );

    this.redisClient.once('ready', () => {
      this.logger.log('Redis ready; retrying IO adapter attachment');
      void this.attachRedisAdapter(server);
    });
  }
}
