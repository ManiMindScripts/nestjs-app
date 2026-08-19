import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource, In } from 'typeorm';
import { AppModule } from './../src/app.module';
import { Role } from './../src/modules/roles/entities/role.entity';
import { UserRole } from './../src/modules/roles/entities/user-role.entity';
import { User } from './../src/modules/users/entities/user.entity';

jest.setTimeout(60_000);

interface AuthResponseBody {
  accessToken: string;
  user: { id: string; email: string };
}

interface SafeUserBody {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  status: string;
  roles?: { id: string; name: string }[];
}

interface PaginatedUsersBody {
  items: SafeUserBody[];
  total: number;
  page: number;
  limit: number;
}

interface RoleBody {
  id: string;
  name: string;
}

const authBody = (res: request.Response): AuthResponseBody =>
  res.body as AuthResponseBody;

const userBody = (res: request.Response): SafeUserBody =>
  res.body as SafeUserBody;

const userListBody = (res: request.Response): PaginatedUsersBody =>
  res.body as PaginatedUsersBody;

describe('Users admin CRUD (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;

  const admin = {
    email: `users_admin_${Date.now()}@example.com`,
    password: 'Password123!',
  };
  const plainUser = {
    email: `users_user_${Date.now()}@example.com`,
    password: 'Password123!',
  };
  const createdUser = {
    email: `users_created_${Date.now()}@example.com`,
    password: 'Password123!',
  };
  let adminToken: string;
  let adminUserId: string;
  let userToken: string;
  let createdUserId: string;
  const createdUserIds: string[] = [];

  const bearer = (token: string): Record<string, string> => ({
    Authorization: `Bearer ${token}`,
  });

  const register = (body: { email: string; password: string }): request.Test =>
    request(app.getHttpServer())
      .post('/api/auth/register')
      .send(body)
      .expect(201);

  const addRole = async (
    targetUserId: string,
    roleName: string,
  ): Promise<void> => {
    const role = await dataSource
      .getRepository(Role)
      .findOneByOrFail({ name: roleName });
    await dataSource
      .getRepository(UserRole)
      .insert({ userId: targetUserId, roleId: role.id });
  };

  const findRole = async (name: string): Promise<RoleBody> => {
    const roles = (
      await request(app.getHttpServer())
        .get('/api/roles')
        .set(bearer(adminToken))
        .expect(200)
    ).body as RoleBody[];
    const role = roles.find((candidate) => candidate.name === name);
    if (!role) {
      throw new Error(`role ${name} not found`);
    }
    return role;
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ThrottlerStorage)
      .useValue(new ThrottlerStorageService())
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

    const adminReg = await register(admin);
    adminToken = authBody(adminReg).accessToken;
    adminUserId = authBody(adminReg).user.id;
    createdUserIds.push(adminUserId);
    await addRole(adminUserId, 'admin');

    const userReg = await register(plainUser);
    userToken = authBody(userReg).accessToken;
    createdUserIds.push(authBody(userReg).user.id);
  });

  afterAll(async () => {
    if (createdUserIds.length > 0) {
      await dataSource.getRepository(User).delete({ id: In(createdUserIds) });
    }
    await app.close();
  });

  it('returns 401 for unauthenticated admin routes', async () => {
    await request(app.getHttpServer()).get('/api/users').expect(401);
    await request(app.getHttpServer())
      .post('/api/users')
      .send({ email: 'x@example.com', password: 'Password123' })
      .expect(401);
  });

  it('returns 403 for a regular user on admin routes', async () => {
    const headers = bearer(userToken);
    await request(app.getHttpServer())
      .get('/api/users')
      .set(headers)
      .expect(403);
    await request(app.getHttpServer())
      .get(`/api/users/${adminUserId}`)
      .set(headers)
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/users')
      .set(headers)
      .send({ email: 'x@example.com', password: 'Password123' })
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/api/users/${adminUserId}`)
      .set(headers)
      .send({ firstName: 'Hacker' })
      .expect(403);
    await request(app.getHttpServer())
      .delete(`/api/users/${adminUserId}`)
      .set(headers)
      .expect(403);
  });

  it('admin creates a user with explicit roles', async () => {
    const userRole = await findRole('user');
    const created = await request(app.getHttpServer())
      .post('/api/users')
      .set(bearer(adminToken))
      .send({
        email: createdUser.email,
        password: createdUser.password,
        firstName: 'Alice',
        lastName: 'Smith',
        roleIds: [userRole.id],
      })
      .expect(201);

    const body = userBody(created);
    createdUserId = body.id;
    createdUserIds.push(body.id);
    expect(body.email).toBe(createdUser.email);
    expect(body.roles).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'user' })]),
    );
  });

  it('admin creates a user with the default role when none given', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/users')
      .set(bearer(adminToken))
      .send({
        email: `users_default_${Date.now()}@example.com`,
        password: 'Password123!',
      })
      .expect(201);

    const body = userBody(created);
    createdUserIds.push(body.id);
    expect(body.roles).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'user' })]),
    );
  });

  it('rejects a duplicate active email with 409', async () => {
    await request(app.getHttpServer())
      .post('/api/users')
      .set(bearer(adminToken))
      .send({
        email: createdUser.email,
        password: createdUser.password,
      })
      .expect(409);
  });

  it('rejects unknown role ids with 400', async () => {
    await request(app.getHttpServer())
      .post('/api/users')
      .set(bearer(adminToken))
      .send({
        email: `users_badrole_${Date.now()}@example.com`,
        password: 'Password123!',
        roleIds: ['00000000-0000-4000-8000-000000000000'],
      })
      .expect(400);
  });

  it('rejects an invalid payload with 400', async () => {
    await request(app.getHttpServer())
      .post('/api/users')
      .set(bearer(adminToken))
      .send({ email: 'not-an-email' })
      .expect(400);
  });

  it('lists users with pagination and search', async () => {
    const list = await request(app.getHttpServer())
      .get('/api/users')
      .set(bearer(adminToken))
      .expect(200);
    const body = userListBody(list);
    expect(body.total).toBeGreaterThanOrEqual(1);
    expect(body.items.length).toBeGreaterThanOrEqual(1);

    const searched = await request(app.getHttpServer())
      .get(`/api/users?q=${encodeURIComponent(createdUser.email)}`)
      .set(bearer(adminToken))
      .expect(200);
    const searchBody = userListBody(searched);
    expect(
      searchBody.items.some((item) => item.email === createdUser.email),
    ).toBe(true);
  });

  it('gets a user with their roles', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/users/${createdUserId}`)
      .set(bearer(adminToken))
      .expect(200);

    const body = userBody(res);
    expect(body.email).toBeDefined();
    expect(body.roles).toBeDefined();
  });

  it('updates a user name', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/users/${createdUserId}`)
      .set(bearer(adminToken))
      .send({ firstName: 'Alicia' })
      .expect(200);

    expect(userBody(res).firstName).toBe('Alicia');
  });

  it('blocks changing your own status', async () => {
    await request(app.getHttpServer())
      .patch(`/api/users/${adminUserId}`)
      .set(bearer(adminToken))
      .send({ status: 'suspended' })
      .expect(400);
  });

  it('replaces a user role set', async () => {
    const adminRole = await findRole('admin');

    const res = await request(app.getHttpServer())
      .put(`/api/users/${createdUserId}/roles`)
      .set(bearer(adminToken))
      .send({ roleIds: [adminRole.id] })
      .expect(200);

    expect(userBody(res).roles).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'admin' })]),
    );
  });

  it('returns 404 for an unknown user', async () => {
    await request(app.getHttpServer())
      .get('/api/users/00000000-0000-4000-8000-000000000000')
      .set(bearer(adminToken))
      .expect(404);
  });

  it('blocks deleting your own account', async () => {
    await request(app.getHttpServer())
      .delete(`/api/users/${adminUserId}`)
      .set(bearer(adminToken))
      .expect(400);
  });

  it('soft-deletes a user, blocking login, and allows email reuse', async () => {
    const deleted = await request(app.getHttpServer())
      .post('/api/users')
      .set(bearer(adminToken))
      .send({
        email: `users_deleted_${Date.now()}@example.com`,
        password: 'Password123!',
      })
      .expect(201);
    const deletedId = userBody(deleted).id;
    const deletedEmail = userBody(deleted).email;
    createdUserIds.push(deletedId);

    // Warm the permission cache for the account, then delete it.
    await request(app.getHttpServer())
      .delete(`/api/users/${deletedId}`)
      .set(bearer(adminToken))
      .expect(204);

    // The account can no longer log in and is no longer listable.
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: deletedEmail, password: 'Password123!' })
      .expect(401);
    await request(app.getHttpServer())
      .get(`/api/users/${deletedId}`)
      .set(bearer(adminToken))
      .expect(404);

    // The partial unique index allows the email to be re-registered.
    const reReg = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: deletedEmail, password: 'Password123!' })
      .expect(201);
    createdUserIds.push(authBody(reReg).user.id);
  });
});
