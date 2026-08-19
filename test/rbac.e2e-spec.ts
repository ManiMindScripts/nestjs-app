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

interface SafeRoleBody {
  id: string;
  name: string;
  isSystem: boolean;
  permissions: { action: string; subject: string }[];
}

interface SafePermissionBody {
  id: string;
  action: string;
  subject: string;
}

const authBody = (res: request.Response): AuthResponseBody =>
  res.body as AuthResponseBody;

const roleBody = (res: request.Response): SafeRoleBody =>
  res.body as SafeRoleBody;

const roleListBody = (res: request.Response): SafeRoleBody[] =>
  res.body as SafeRoleBody[];

const permissionListBody = (res: request.Response): SafePermissionBody[] =>
  res.body as SafePermissionBody[];

describe('RBAC (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;

  const admin = {
    email: `rbac_admin_${Date.now()}@example.com`,
    password: 'Password123!',
  };
  const user = {
    email: `rbac_user_${Date.now()}@example.com`,
    password: 'Password123!',
  };
  let adminToken: string;
  let adminUserId: string;
  let userToken: string;
  let userId: string;
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

  const findRole = async (name: string): Promise<SafeRoleBody> => {
    const roles = roleListBody(
      await request(app.getHttpServer())
        .get('/api/roles')
        .set(bearer(adminToken))
        .expect(200),
    );
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

    const userReg = await register(user);
    userToken = authBody(userReg).accessToken;
    userId = authBody(userReg).user.id;
    createdUserIds.push(userId);
  });

  afterAll(async () => {
    // Remove the accounts this suite registered so repeated runs leave no residue.
    if (createdUserIds.length > 0) {
      await dataSource.getRepository(User).delete({ id: In(createdUserIds) });
    }
    await app.close();
  });

  it('returns 401 for unauthenticated admin routes', async () => {
    await request(app.getHttpServer()).get('/api/roles').expect(401);
    await request(app.getHttpServer()).get('/api/permissions').expect(401);
  });

  it('returns 403 for a regular user on admin routes', async () => {
    await request(app.getHttpServer())
      .get('/api/roles')
      .set(bearer(userToken))
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/permissions')
      .set(bearer(userToken))
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/roles')
      .set(bearer(userToken))
      .send({ name: 'hacker' })
      .expect(403);
  });

  it('returns 200 for an admin on role and permission lists', async () => {
    await request(app.getHttpServer())
      .get('/api/roles')
      .set(bearer(adminToken))
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/permissions')
      .set(bearer(adminToken))
      .expect(200);
  });

  it('admin can create a permission; duplicates conflict with 409', async () => {
    const headers = bearer(adminToken);

    // Recover from any previously aborted run: reuse an existing permission
    // instead of failing on the 409 that a pre-created row would cause.
    const existing = permissionListBody(
      await request(app.getHttpServer())
        .get('/api/permissions')
        .set(headers)
        .expect(200),
    ).find(
      (permission) =>
        permission.action === 'read' && permission.subject === 'Permission',
    );

    let createdId = existing?.id;
    if (!createdId) {
      const created = await request(app.getHttpServer())
        .post('/api/permissions')
        .set(headers)
        .send({
          action: 'read',
          subject: 'Permission',
          description: 'Read permissions',
        })
        .expect(201);
      createdId = (created.body as SafePermissionBody).id;
    }
    expect(createdId).toBeDefined();

    await request(app.getHttpServer())
      .post('/api/permissions')
      .set(headers)
      .send({ action: 'read', subject: 'Permission' })
      .expect(409);

    // Clean up so repeated runs stay deterministic.
    await request(app.getHttpServer())
      .delete(`/api/permissions/${createdId}`)
      .set(headers)
      .expect(204);
  });

  it('admin can create a role; duplicate names conflict with 409', async () => {
    const headers = bearer(adminToken);

    // Recover from any previously aborted run: clear a leftover 'editor' role.
    const leftover = roleListBody(
      await request(app.getHttpServer())
        .get('/api/roles')
        .set(headers)
        .expect(200),
    ).find((role) => role.name === 'editor');
    if (leftover) {
      await request(app.getHttpServer())
        .delete(`/api/roles/${leftover.id}`)
        .set(headers)
        .expect(204);
    }

    const created = await request(app.getHttpServer())
      .post('/api/roles')
      .set(headers)
      .send({ name: 'editor', description: 'Editors' })
      .expect(201);
    expect(roleBody(created).isSystem).toBe(false);

    await request(app.getHttpServer())
      .post('/api/roles')
      .set(headers)
      .send({ name: 'editor' })
      .expect(409);
  });

  it('role permission set rejects unknown ids with 400 before applying changes', async () => {
    const editor = await findRole('editor');

    await request(app.getHttpServer())
      .put(`/api/roles/${editor.id}/permissions`)
      .set(bearer(adminToken))
      .send({ permissionIds: ['00000000-0000-4000-8000-000000000000'] })
      .expect(400);
  });

  it('system roles are immutable', async () => {
    const adminRole = await findRole('admin');

    await request(app.getHttpServer())
      .patch(`/api/roles/${adminRole.id}`)
      .set(bearer(adminToken))
      .send({ name: 'root' })
      .expect(403);
    await request(app.getHttpServer())
      .delete(`/api/roles/${adminRole.id}`)
      .set(bearer(adminToken))
      .expect(403);
    await request(app.getHttpServer())
      .put(`/api/roles/${adminRole.id}/permissions`)
      .set(bearer(adminToken))
      .send({ permissionIds: [] })
      .expect(403);
  });

  it('promoting a user grants access immediately (cache invalidation, not TTL luck)', async () => {
    // Warm the regular user's permission cache with a 403 first.
    await request(app.getHttpServer())
      .get('/api/roles')
      .set(bearer(userToken))
      .expect(403);

    const adminRole = await findRole('admin');
    await request(app.getHttpServer())
      .put(`/api/users/${userId}/roles`)
      .set(bearer(adminToken))
      .send({ roleIds: [adminRole.id] })
      .expect(200);

    await request(app.getHttpServer())
      .get('/api/roles')
      .set(bearer(userToken))
      .expect(200);
  });

  it('setRoles rejects unknown role ids with 400', async () => {
    await request(app.getHttpServer())
      .put(`/api/users/${userId}/roles`)
      .set(bearer(adminToken))
      .send({ roleIds: ['00000000-0000-4000-8000-000000000000'] })
      .expect(400);
  });

  it('removing a permission from a role revokes access immediately', async () => {
    const editor = await findRole('editor');
    const permissions = permissionListBody(
      await request(app.getHttpServer())
        .get('/api/permissions')
        .set(bearer(adminToken))
        .expect(200),
    );
    const manageRole = permissions.find(
      (permission) =>
        permission.action === 'manage' && permission.subject === 'Role',
    );
    if (!manageRole) {
      throw new Error('manage:Role permission not found');
    }

    await request(app.getHttpServer())
      .put(`/api/roles/${editor.id}/permissions`)
      .set(bearer(adminToken))
      .send({ permissionIds: [manageRole.id] })
      .expect(200);
    await request(app.getHttpServer())
      .put(`/api/users/${userId}/roles`)
      .set(bearer(adminToken))
      .send({ roleIds: [editor.id] })
      .expect(200);

    // Cache warm: the user now resolves manage:Role through the editor role.
    await request(app.getHttpServer())
      .get('/api/roles')
      .set(bearer(userToken))
      .expect(200);

    // Strip manage:Role from editor -> immediate 403, no TTL wait.
    await request(app.getHttpServer())
      .put(`/api/roles/${editor.id}/permissions`)
      .set(bearer(adminToken))
      .send({ permissionIds: [] })
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/roles')
      .set(bearer(userToken))
      .expect(403);
  });

  it('admin can delete a custom role', async () => {
    const editor = await findRole('editor');

    await request(app.getHttpServer())
      .delete(`/api/roles/${editor.id}`)
      .set(bearer(adminToken))
      .expect(204);
  });
});
