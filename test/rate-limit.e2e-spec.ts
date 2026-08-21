import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import type { Express } from 'express';
import type { Server as HttpServer } from 'http';
import type { AddressInfo } from 'net';
import request from 'supertest';
import { DataSource, In } from 'typeorm';
import { validationPipeOptions } from './../src/common/pipes/validation-pipe-options';
import { buildCorsOptions } from './../src/config/cors.config';
import { applyTrustProxy } from './../src/config/trust-proxy';
import { AppModule } from './../src/app.module';
import { UserRole } from './../src/modules/roles/entities/user-role.entity';
import { RedisIoAdapter } from './../src/modules/realtime/redis-io.adapter';
import { User } from './../src/modules/users/entities/user.entity';

jest.setTimeout(90_000);

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

interface AppOptions {
  limit: number;
  ttlSeconds: number;
  trustProxy?: string;
}

interface TestApp {
  app: INestApplication;
  port: number;
  userIds: string[];
}

interface AuthResponseBody {
  accessToken: string;
  user: { id: string };
}

describe('Rate limiting (e2e)', () => {
  const originalEnv = {
    THROTTLE_LIMIT: process.env.THROTTLE_LIMIT,
    THROTTLE_TTL: process.env.THROTTLE_TTL,
    TRUST_PROXY: process.env.TRUST_PROXY,
  };
  const runningApps: TestApp[] = [];

  afterEach(async () => {
    for (const { app, userIds } of runningApps.splice(0)) {
      if (userIds.length > 0) {
        const dataSource = app.get(DataSource);
        await dataSource.getRepository(UserRole).delete({
          userId: In(userIds),
        });
        await dataSource.getRepository(User).delete({ id: In(userIds) });
      }
      await app.close();
    }
  });

  afterAll(() => {
    Object.entries(originalEnv).forEach(([key, value]) => {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    });
  });

  // Every test boots its own app with a dedicated in-memory throttler storage,
  // so buckets never leak between tests or across suite runs.
  const createApp = async ({
    limit,
    ttlSeconds,
    trustProxy,
  }: AppOptions): Promise<TestApp> => {
    process.env.THROTTLE_LIMIT = String(limit);
    process.env.THROTTLE_TTL = String(ttlSeconds);
    if (trustProxy === undefined) {
      delete process.env.TRUST_PROXY;
    } else {
      process.env.TRUST_PROXY = trustProxy;
    }

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ThrottlerStorage)
      .useValue(new ThrottlerStorageService())
      .compile();

    const app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe(validationPipeOptions));
    applyTrustProxy(app.getHttpAdapter().getInstance() as Express, trustProxy);
    app.useWebSocketAdapter(
      new RedisIoAdapter(app, buildCorsOptions('http://localhost:5173')),
    );
    await app.init();
    await app.listen(0);
    const httpServer = app.getHttpServer() as HttpServer;
    const { port } = httpServer.address() as AddressInfo;

    const testApp: TestApp = { app, port, userIds: [] };
    runningApps.push(testApp);
    return testApp;
  };

  const registerUser = async (
    { app, userIds }: TestApp,
    email: string,
  ): Promise<AuthResponseBody> => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, password: 'Password123!' })
      .expect(201);
    const body = response.body as AuthResponseBody;
    userIds.push(body.user.id);
    return body;
  };

  const getMe = (
    { app }: TestApp,
    token: string,
    forwardedFor?: string,
  ): request.Test => {
    const test = request(app.getHttpServer())
      .get('/api/users/me')
      .set('Authorization', `Bearer ${token}`);
    return forwardedFor === undefined
      ? test
      : test.set('X-Forwarded-For', forwardedFor);
  };

  it('returns 429 with the standard error body and Retry-After once the global limit is exceeded', async () => {
    const target = await createApp({ limit: 3, ttlSeconds: 60 });
    const { accessToken } = await registerUser(
      target,
      `rl_global_${Date.now()}@example.com`,
    );

    for (let i = 0; i < 3; i += 1) {
      await getMe(target, accessToken).expect(200);
    }
    const blocked = await getMe(target, accessToken).expect(429);

    expect(blocked.headers['retry-after']).toBeDefined();
    const body = blocked.body as {
      statusCode: number;
      message: string;
      path: string;
      timestamp: string;
    };
    expect(body.statusCode).toBe(429);
    expect(body.path).toBe('/api/users/me');
    expect(body.message).toContain('Too Many Requests');
    expect(body.timestamp).toBeDefined();
  });

  it('exposes X-RateLimit headers on successful responses', async () => {
    const target = await createApp({ limit: 10, ttlSeconds: 60 });
    const { accessToken } = await registerUser(
      target,
      `rl_headers_${Date.now()}@example.com`,
    );

    const response = await getMe(target, accessToken).expect(200);

    expect(response.headers['x-ratelimit-limit']).toBe('10');
    expect(response.headers['x-ratelimit-remaining']).toBeDefined();
    expect(response.headers['x-ratelimit-reset']).toBeDefined();
  });

  it('keeps the dedicated stricter bucket on auth routes', async () => {
    const target = await createApp({ limit: 100, ttlSeconds: 60 });
    const email = `rl_login_${Date.now()}@example.com`;
    await registerUser(target, email);

    for (let i = 0; i < 5; i += 1) {
      await request(target.app.getHttpServer())
        .post('/api/auth/login')
        .send({ email, password: 'WrongPassword123!' })
        .expect(401);
    }
    await request(target.app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: 'WrongPassword123!' })
      .expect(429);
  });

  it('resets buckets after the window expires', async () => {
    const target = await createApp({ limit: 3, ttlSeconds: 2 });
    const { accessToken } = await registerUser(
      target,
      `rl_reset_${Date.now()}@example.com`,
    );

    for (let i = 0; i < 3; i += 1) {
      await getMe(target, accessToken).expect(200);
    }
    await getMe(target, accessToken).expect(429);

    await sleep(2_300);
    await getMe(target, accessToken).expect(200);
  });

  it('keys authenticated buckets by user id even when the client IP rotates', async () => {
    const target = await createApp({
      limit: 3,
      ttlSeconds: 60,
      trustProxy: '1',
    });
    const { accessToken } = await registerUser(
      target,
      `rl_user_${Date.now()}@example.com`,
    );

    // Each request presents a different trusted-proxy-resolved address, so the
    // IP wall never accumulates; only the per-user bucket can trip.
    for (let i = 0; i < 3; i += 1) {
      await getMe(target, accessToken, `203.0.113.${i + 10}`).expect(200);
    }
    await getMe(target, accessToken, '203.0.113.99').expect(429);
  });

  it('caps floods that rotate accounts behind one shared IP', async () => {
    const target = await createApp({ limit: 3, ttlSeconds: 60 });
    const userA = await registerUser(
      target,
      `rl_ip_a_${Date.now()}@example.com`,
    );
    const userB = await registerUser(
      target,
      `rl_ip_b_${Date.now()}@example.com`,
    );

    // Alternating accounts share the untrusted-IP bucket (XFF ignored), which
    // trips while neither per-user bucket reaches the limit.
    await getMe(target, userA.accessToken).expect(200);
    await getMe(target, userB.accessToken).expect(200);
    await getMe(target, userA.accessToken).expect(200);
    await getMe(target, userB.accessToken).expect(429);
  });
});
