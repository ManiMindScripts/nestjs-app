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
const RETRY_DELAY_MS = 500;

export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private readonly app: INestApplicationContext;
  private readonly redisClient: Redis;
  private readonly adapterStatus: RealtimeAdapterStatus;
  private redisAttached = false;
  private pubClient: Redis | null = null;
  private subClient: Redis | null = null;

  constructor(
    app: INestApplicationContext,
    private readonly corsOptions: CorsOptions,
  ) {
    super(app);
    this.app = app;
    this.redisClient = app.get<Redis>(REDIS_CLIENT);
    this.adapterStatus = app.get<RealtimeAdapterStatus>(RealtimeAdapterStatus);
  }

  create(port: number, options?: ServerOptions): Server {
    const server = super.create(port, options);
    this.attachConnectRateLimit(server);
    return server;
  }

  createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, {
      ...options,
      cors: this.corsOptions,
    }) as Server;
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

    let pingTimeout: NodeJS.Timeout | undefined;
    const timedOut = new Promise<never>((_, reject) => {
      pingTimeout = setTimeout(
        () => reject(new Error('Redis adapter ping timed out')),
        ADAPTER_PING_TIMEOUT_MS,
      );
    });

    try {
      await Promise.race([
        Promise.all([pubClient.ping(), subClient.ping()]),
        timedOut,
      ]);
      clearTimeout(pingTimeout);
    } catch (error) {
      clearTimeout(pingTimeout);
      pubClient.disconnect();
      subClient.disconnect();
      this.degrade(server, error);
      return;
    }

    server.adapter(createAdapter(pubClient, subClient));
    this.pubClient = pubClient;
    this.subClient = subClient;
    this.redisAttached = true;
    this.adapterStatus.markAttached();
    this.logger.log('Redis IO adapter attached');
  }

  override async dispose(): Promise<void> {
    if (this.pubClient) {
      this.pubClient.disconnect();
      this.pubClient = null;
    }
    if (this.subClient) {
      this.subClient.disconnect();
      this.subClient = null;
    }
    await super.dispose();
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

    if (this.redisClient.status === 'ready') {
      // 'ready' was already emitted before a listener could be attached, so
      // retry shortly instead of waiting for an event that will not come.
      setTimeout(() => void this.attachRedisAdapter(server), RETRY_DELAY_MS);
      return;
    }
    this.redisClient.once('ready', () => {
      this.logger.log('Redis ready; retrying IO adapter attachment');
      void this.attachRedisAdapter(server);
    });
  }
}
