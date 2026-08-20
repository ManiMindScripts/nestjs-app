import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Response } from 'express';
import { Redis } from 'ioredis';
import { DataSource } from 'typeorm';
import { Public } from '../../common/decorators/public.decorator';
import { REDIS_CLIENT } from '../../shared/redis/redis.module';
import { RealtimeAdapterStatus } from '../realtime/realtime-adapter.status';

interface ProbeResult {
  status: 'up' | 'down';
  latencyMs: number;
  error?: string;
}

type RedisAdapterProbe =
  | { status: 'ok' }
  | { status: 'degraded'; reason: string | null; since: string | null };

interface HealthResponse {
  status: 'ok' | 'degraded';
  db: ProbeResult;
  redis: ProbeResult;
  redisAdapter: RedisAdapterProbe;
  timestamp: string;
}

@ApiTags('health')
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly adapterStatus: RealtimeAdapterStatus,
  ) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Health check (liveness + dependency probes)' })
  async check(
    @Res({ passthrough: true }) response: Response,
  ): Promise<HealthResponse> {
    const db = await this.probe(() => this.dataSource.query('SELECT 1'));
    const redis = await this.probe(() => this.redis.ping());
    const redisAdapter: RedisAdapterProbe = this.adapterStatus.isDegraded
      ? {
          status: 'degraded',
          reason: this.adapterStatus.reason,
          since: this.adapterStatus.since,
        }
      : { status: 'ok' };

    const degraded =
      db.status === 'down' ||
      redis.status === 'down' ||
      redisAdapter.status === 'degraded';
    if (degraded) {
      response.status(HttpStatus.SERVICE_UNAVAILABLE);
    }

    return {
      status: degraded ? 'degraded' : 'ok',
      db,
      redis,
      redisAdapter,
      timestamp: new Date().toISOString(),
    };
  }

  private async probe(operation: () => Promise<unknown>): Promise<ProbeResult> {
    const start = Date.now();
    try {
      await operation();
      return { status: 'up', latencyMs: Date.now() - start };
    } catch (error) {
      return {
        status: 'down',
        latencyMs: Date.now() - start,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
