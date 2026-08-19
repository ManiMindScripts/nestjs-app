import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from './../src/app.module';
import { MailService } from './../src/modules/auth/mail/mail.service';
import { User } from './../src/modules/users/entities/user.entity';

jest.setTimeout(60_000);

describe('Auth (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let capturedResetToken: string | undefined;
  let createdUserId: string | undefined;

  interface AuthResponseBody {
    accessToken: string;
    user: { id: string; email: string };
  }

  const authBody = (res: request.Response): AuthResponseBody =>
    res.body as AuthResponseBody;

  const email = `e2e_${Date.now()}@example.com`;
  const password = 'Password123!';
  const COOKIE_NAME = 'refresh_token';

  const cookieValue = (res: request.Response): string => {
    const setCookie = res.headers['set-cookie'] as string[] | undefined;
    const cookie = setCookie?.find((c) => c.startsWith(`${COOKIE_NAME}=`));
    return cookie?.split(';')[0] ?? '';
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ThrottlerStorage)
      .useValue(new ThrottlerStorageService())
      .overrideProvider(MailService)
      .useValue({
        sendPasswordReset: jest.fn(
          (_email: string, token: string): Promise<void> => {
            capturedResetToken = token;
            return Promise.resolve();
          },
        ),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
    dataSource = app.get(DataSource);
  });

  afterAll(async () => {
    // Remove the account this suite registered so repeated runs leave no residue.
    if (createdUserId) {
      await dataSource.getRepository(User).delete({ id: createdUserId });
    }
    await app.close();
  });

  it('rejects unauthenticated access to protected routes', async () => {
    await request(app.getHttpServer()).get('/api/users/me').expect(401);
  });

  it('register -> me -> refresh -> theft detection -> logout', async () => {
    const registerRes = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, password })
      .expect(201);

    expect(authBody(registerRes).accessToken).toBeDefined();
    expect(authBody(registerRes).user.email).toBe(email);
    createdUserId = authBody(registerRes).user.id;
    expect(createdUserId).toBeDefined();
    expect(
      (registerRes.body as { user?: { passwordHash?: string } }).user
        ?.passwordHash,
    ).toBeUndefined();
    const registerCookie = cookieValue(registerRes);
    expect(registerCookie).toContain(`${COOKIE_NAME}=`);

    const meRes = await request(app.getHttpServer())
      .get('/api/users/me')
      .set('Authorization', `Bearer ${authBody(registerRes).accessToken}`)
      .expect(200);
    expect((meRes.body as { email: string }).email).toBe(email);

    const refreshRes = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', registerCookie)
      .expect(200);
    expect(authBody(refreshRes).accessToken).toBeDefined();
    const rotatedCookie = cookieValue(refreshRes);
    expect(rotatedCookie).not.toBe(registerCookie);

    // Reusing an already-rotated token is treated as theft and kills the family.
    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', registerCookie)
      .expect(401);

    // The freshly rotated token is dead too after family revocation.
    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', rotatedCookie)
      .expect(401);

    const loginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password })
      .expect(200);
    const loginCookie = cookieValue(loginRes);

    await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Cookie', loginCookie)
      .expect(204);

    // The logged-out token can no longer be used to refresh.
    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', loginCookie)
      .expect(401);
  });

  it('forgot -> reset -> old password rejected -> new password works', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/forgot-password')
      .send({ email })
      .expect(200);

    expect(capturedResetToken).toBeDefined();
    const newPassword = 'NewPassword456!';

    await request(app.getHttpServer())
      .post('/api/auth/reset-password')
      .send({ token: capturedResetToken, newPassword })
      .expect(204);

    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password })
      .expect(401);

    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: newPassword })
      .expect(200);

    // Reset tokens are single-use.
    await request(app.getHttpServer())
      .post('/api/auth/reset-password')
      .send({ token: capturedResetToken, newPassword: 'YetAnother123!' })
      .expect(400);
  });
});
