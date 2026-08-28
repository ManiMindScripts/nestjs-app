import {
  Controller,
  Get,
  HttpStatus,
  Inject,
  Logger,
  Res,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Response } from 'express';
import { Redis } from 'ioredis';
import { DataSource } from 'typeorm';
import { Public } from '../../common/decorators/public.decorator';
import { REDIS_CLIENT } from '../../shared/redis/redis.module';
import { RealtimeAdapterStatus } from '../realtime/realtime-adapter.status';
import { MailQueueStatus } from '../auth/mail/mail-queue.status';

interface ProbeResult {
  status: 'up' | 'down';
  latencyMs: number;
  error?: string;
}

type RedisAdapterProbe =
  | { status: 'ok' }
  | {
      status: 'degraded' | 'pending';
      reason: string | null;
      since: string | null;
    };

/**
 * Informational only: a sticky "last permanent failure" is not the same as
 * current SMTP health, so unlike the adapter probe it does NOT flip the
 * overall status. Active alerting for these failures comes from the
 * alerting webhook, not from uptime monitors polling this field.
 */
interface MailProbe {
  lastFailureReason: string | null;
  lastFailureAt: string | null;
}

interface HealthResponse {
  status: 'ok' | 'degraded';
  db: ProbeResult;
  redis: ProbeResult;
  redisAdapter: RedisAdapterProbe;
  mail: MailProbe;
  timestamp: string;
}

@ApiTags('health')
@SkipThrottle()
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly adapterStatus: RealtimeAdapterStatus,
    private readonly mailQueueStatus: MailQueueStatus,
  ) {}

  @Public()
  @Get('ping')
  @ApiOperation({ summary: 'Liveness check (process is up)' })
  ping(): { status: 'ok'; timestamp: string } {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Public()
  @Get()
  @ApiOperation({ summary: 'Health check (liveness + dependency probes)' })
  async check(
    @Res({ passthrough: true }) response: Response,
  ): Promise<HealthResponse> {
    const db = await this.probe(() => this.dataSource.query('SELECT 1'));
    const redis = await this.probe(() => this.redis.ping());
    const redisAdapter: RedisAdapterProbe = this.adapterStatus.isAttached
      ? { status: 'ok' }
      : this.adapterStatus.isDegraded
        ? {
            status: 'degraded',
            reason: this.adapterStatus.reason,
            since: this.adapterStatus.since,
          }
        : { status: 'pending', reason: null, since: null };

    const degraded =
      db.status === 'down' ||
      redis.status === 'down' ||
      redisAdapter.status !== 'ok';
    if (degraded) {
      response.status(HttpStatus.SERVICE_UNAVAILABLE);
    }

    const mail: MailProbe = {
      lastFailureReason: this.mailQueueStatus.failure?.reason ?? null,
      lastFailureAt: this.mailQueueStatus.failure?.at ?? null,
    };

    return {
      status: degraded ? 'degraded' : 'ok',
      db,
      redis,
      redisAdapter,
      mail,
      timestamp: new Date().toISOString(),
    };
  }

  private async probe(operation: () => Promise<unknown>): Promise<ProbeResult> {
    const start = Date.now();
    try {
      await operation();
      return { status: 'up', latencyMs: Date.now() - start };
    } catch (error) {
      // Driver messages can contain hosts, ports and internals: keep the
      // detail server-side and expose only a generic marker publicly.
      this.logger.error(
        `Health probe failed after ${Date.now() - start}ms`,
        error instanceof Error ? error.stack : String(error),
      );
      return {
        status: 'down',
        latencyMs: Date.now() - start,
        error: 'unreachable',
      };
    }
  }
}
