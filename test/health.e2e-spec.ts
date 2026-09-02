import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { MailQueueStatus } from './../src/modules/auth/mail/mail-queue.status';
import { HealthController } from './../src/modules/health/health.controller';
import { RealtimeAdapterStatus } from './../src/modules/realtime/realtime-adapter.status';
import { attachRedisErrorHandler } from './../src/shared/redis/redis-client.error-handler';
import { REDIS_CLIENT } from './../src/shared/redis/redis.module';

jest.setTimeout(30_000);

interface HealthBody {
  status: 'ok' | 'degraded';
  db: { status: 'up' | 'down' };
  redis: { status: 'up' | 'down' };
  redisAdapter: { status: string };
}

describe('Health failure states (e2e)', () => {
  // The happy path (200 "ok" with a live redis adapter) is already asserted in
  // test/realtime.e2e-spec.ts, so this suite focuses on the failure mechanisms.
  //
  // An unhandled 'error' event on an ioredis client crashes the process, so the
  // degraded path cannot be simulated by pointing the shared connection at an
  // unreachable host in-process. Instead we boot an ISOLATED app that registers
  // ONLY the health controller against REAL DataSource/Redis drivers pointed at
  // an unreachable endpoint. This exercises the real probe() -> down -> 503
  // logic without a mock standing in for it, and works identically in CI and
  // locally (no docker stop required).
  const buildDegradedApp = async (): Promise<INestApplication> => {
    const dataSource = new DataSource({
      type: 'postgres',
      host: '127.0.0.1',
      port: 1,
      username: 'test',
      password: 'test',
      database: 'test',
      synchronize: false,
      // Deliberately NOT initialized: dataSource.query() throws
      // "Driver not Connected", which the probe maps to status 'down'.
    });

    const redis = new Redis({
      host: '127.0.0.1',
      port: 1,
      lazyConnect: true,
      connectTimeout: 500,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    });
    // Without a listener, ioredis would emit an unhandled 'error' and crash the
    // test process instead of letting the probe report 'down'. This is the same
    // audit fix the app relies on in production.
    attachRedisErrorHandler(redis, 'test');

    const moduleFixture = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: DataSource, useValue: dataSource },
        { provide: REDIS_CLIENT, useValue: redis },
        RealtimeAdapterStatus,
        MailQueueStatus,
      ],
    }).compile();

    const app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    return app;
  };

  it('reports degraded (503) when db and redis are unreachable', async () => {
    const app = await buildDegradedApp();
    try {
      const response = await request(app.getHttpServer())
        .get('/api/health')
        .expect(503);
      const body = response.body as HealthBody;

      expect(body.status).toBe('degraded');
      expect(body.db.status).toBe('down');
      expect(body.redis.status).toBe('down');
      expect(body.redisAdapter.status).not.toBe('ok');
    } finally {
      await app.close();
    }
  });

  it('/health/ping returns 200 regardless of dependency health', async () => {
    const app = await buildDegradedApp();
    try {
      const response = await request(app.getHttpServer())
        .get('/api/health/ping')
        .expect(200);
      expect((response.body as { status: string }).status).toBe('ok');
    } finally {
      await app.close();
    }
  });
});
