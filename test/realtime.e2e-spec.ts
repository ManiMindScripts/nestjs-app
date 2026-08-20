import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import type { Server as HttpServer } from 'http';
import type { AddressInfo } from 'net';
import request from 'supertest';
import { io, Socket } from 'socket.io-client';
import { DataSource, In } from 'typeorm';
import { UserStatus } from './../src/common/constants/user-status.enum';
import { validationPipeOptions } from './../src/common/pipes/validation-pipe-options';
import { buildCorsOptions } from './../src/config/cors.config';
import { AppModule } from './../src/app.module';
import { Permission } from './../src/modules/permissions/entities/permission.entity';
import { RolePermission } from './../src/modules/permissions/entities/role-permission.entity';
import { NotificationsGateway } from './../src/modules/realtime/gateways/notifications.gateway';
import { RealtimeAdapterStatus } from './../src/modules/realtime/realtime-adapter.status';
import { RedisIoAdapter } from './../src/modules/realtime/redis-io.adapter';
import { Role } from './../src/modules/roles/entities/role.entity';
import { UserRole } from './../src/modules/roles/entities/user-role.entity';
import { User } from './../src/modules/users/entities/user.entity';

jest.setTimeout(90_000);

const NAMESPACE = '/notifications';
const socketUrl = (port: number): string =>
  `http://127.0.0.1:${port}${NAMESPACE}`;

interface AuthResponseBody {
  accessToken: string;
  user: { id: string; email: string };
}

interface BroadcastPayload {
  title: string;
  message: string;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const waitForEvent = <T = unknown>(
  socket: Socket,
  event: string,
  timeoutMs = 4_000,
): Promise<T> => {
  let timer: NodeJS.Timeout;
  return new Promise((resolve, reject) => {
    const onEvent = (payload: T): void => {
      clearTimeout(timer);
      resolve(payload);
    };
    timer = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error(`Timed out waiting for socket event "${event}"`));
    }, timeoutMs);
    socket.once(event, onEvent);
  });
};

const waitForDisconnect = (
  socket: Socket,
  timeoutMs = 4_000,
): Promise<string> => {
  let timer: NodeJS.Timeout;
  return new Promise((resolve, reject) => {
    const onDisconnect = (reason: string): void => {
      clearTimeout(timer);
      resolve(reason);
    };
    timer = setTimeout(() => {
      socket.off('disconnect', onDisconnect);
      reject(new Error('Timed out waiting for socket disconnect'));
    }, timeoutMs);
    socket.once('disconnect', onDisconnect);
  });
};

const expectNoEvent = async (
  socket: Socket,
  event: string,
  windowMs = 700,
): Promise<void> => {
  const listener = jest.fn();
  socket.on(event, listener);
  await sleep(windowMs);
  expect(listener).not.toHaveBeenCalled();
  socket.off(event, listener);
};

const connectSocket = (port: number, token?: string): Promise<Socket> =>
  new Promise((resolve, reject) => {
    const socket = io(socketUrl(port), {
      transports: ['websocket', 'polling'],
      forceNew: true,
      reconnection: false,
      auth: token ? { token } : {},
    });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', (error: Error) => {
      socket.close();
      reject(error);
    });
  });

// The server rejects unauthenticated connections immediately after the
// namespace handshake, so the disconnect listener must be attached before the
// connection completes to avoid racing past the event.
const connectSocketWithDisconnect = (
  port: number,
): Promise<{ socket: Socket; disconnected: Promise<string> }> =>
  new Promise((resolve, reject) => {
    const socket = io(socketUrl(port), {
      transports: ['websocket', 'polling'],
      forceNew: true,
      reconnection: false,
      auth: {},
    });
    const disconnected = waitForDisconnect(socket);
    socket.once('connect', () => resolve({ socket, disconnected }));
    socket.once('connect_error', (error: Error) => {
      socket.close();
      reject(error);
    });
  });

const waitForAdapterAttached = async (app: INestApplication): Promise<void> => {
  const status = app.get(RealtimeAdapterStatus);
  const deadline = Date.now() + 10_000;
  while (!status.isAttached) {
    if (Date.now() > deadline) {
      throw new Error('Redis IO adapter did not attach in time');
    }
    await sleep(100);
  }
  // Let the redis-adapter's async channel subscription settle.
  await sleep(200);
};

const createApp = async (): Promise<{
  app: INestApplication;
  port: number;
}> => {
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
  app.useWebSocketAdapter(
    new RedisIoAdapter(app, buildCorsOptions('http://localhost:5173')),
  );
  await app.init();
  await app.listen(0);
  const httpServer = app.getHttpServer() as HttpServer;
  const address = httpServer.address() as AddressInfo;
  return { app, port: address.port };
};

describe('Realtime (e2e)', () => {
  let appA: INestApplication;
  let appB: INestApplication;
  let portA: number;
  let portB: number;
  let dataSource: DataSource;

  const admin = {
    email: `rt_admin_${Date.now()}@example.com`,
    password: 'Password123!',
  };
  const userA = {
    email: `rt_user_a_${Date.now()}@example.com`,
    password: 'Password123!',
  };
  const userB = {
    email: `rt_user_b_${Date.now()}@example.com`,
    password: 'Password123!',
  };

  let adminToken: string;
  let adminUserId: string;
  let userAToken: string;
  let userAId: string;
  let userBToken: string;
  let userBId: string;
  const createdUserIds: string[] = [];
  let notifPermissionId: string;
  let notifPermissionCreated = false;
  let realtimeAdminRoleId: string;

  let adminSocket: Socket;
  let userASocket: Socket;
  let userBSocket: Socket;

  const bearer = (token: string): Record<string, string> => ({
    Authorization: `Bearer ${token}`,
  });

  const register = (
    app: INestApplication,
    body: { email: string; password: string },
  ): request.Test =>
    request(app.getHttpServer())
      .post('/api/auth/register')
      .send(body)
      .expect(201);

  beforeAll(async () => {
    const appAContext = await createApp();
    appA = appAContext.app;
    portA = appAContext.port;
    const appBContext = await createApp();
    appB = appBContext.app;
    portB = appBContext.port;

    await waitForAdapterAttached(appA);
    await waitForAdapterAttached(appB);
    dataSource = appA.get(DataSource);

    const registerOnA = (body: {
      email: string;
      password: string;
    }): Promise<AuthResponseBody> =>
      register(appA, body).then((res) => res.body as AuthResponseBody);

    const adminSession = await registerOnA(admin);
    adminToken = adminSession.accessToken;
    adminUserId = adminSession.user.id;
    createdUserIds.push(adminUserId);
    const adminRole = await dataSource
      .getRepository(Role)
      .findOneByOrFail({ name: 'admin' });
    await dataSource
      .getRepository(UserRole)
      .insert({ userId: adminUserId, roleId: adminRole.id });

    const userASession = await registerOnA(userA);
    userAToken = userASession.accessToken;
    userAId = userASession.user.id;
    createdUserIds.push(userAId);

    const userBSession = await registerOnA(userB);
    userBToken = userBSession.accessToken;
    userBId = userBSession.user.id;
    createdUserIds.push(userBId);

    // Grant the admin manage:Notification via a custom role (system roles are
    // immutable, so the seeded admin role cannot be modified).
    const headers = bearer(adminToken);
    const permissions = (
      await request(appA.getHttpServer())
        .get('/api/permissions')
        .set(headers)
        .expect(200)
    ).body as { id: string; action: string; subject: string }[];
    const existing = permissions.find(
      (permission) =>
        permission.action === 'manage' && permission.subject === 'Notification',
    );
    if (existing) {
      notifPermissionId = existing.id;
    } else {
      const created = await request(appA.getHttpServer())
        .post('/api/permissions')
        .set(headers)
        .send({
          action: 'manage',
          subject: 'Notification',
          description: 'Broadcast notifications',
        })
        .expect(201);
      notifPermissionId = (created.body as { id: string }).id;
      notifPermissionCreated = true;
    }

    // Recover from any previously aborted run: drop a leftover role.
    const roles = (
      await request(appA.getHttpServer())
        .get('/api/roles')
        .set(headers)
        .expect(200)
    ).body as { id: string; name: string }[];
    const leftover = roles.find((role) => role.name === 'realtime_admin');
    if (leftover) {
      await request(appA.getHttpServer())
        .delete(`/api/roles/${leftover.id}`)
        .set(headers)
        .expect(204);
    }

    const createdRole = await request(appA.getHttpServer())
      .post('/api/roles')
      .set(headers)
      .send({ name: 'realtime_admin', description: 'Broadcast notifications' })
      .expect(201);
    realtimeAdminRoleId = (createdRole.body as { id: string }).id;

    await request(appA.getHttpServer())
      .put(`/api/roles/${realtimeAdminRoleId}/permissions`)
      .set(headers)
      .send({ permissionIds: [notifPermissionId] })
      .expect(200);

    await request(appA.getHttpServer())
      .put(`/api/users/${adminUserId}/roles`)
      .set(headers)
      .send({ roleIds: [adminRole.id, realtimeAdminRoleId] })
      .expect(200);

    adminSocket = await connectSocket(portA, adminToken);
    userASocket = await connectSocket(portA, userAToken);
    userBSocket = await connectSocket(portB, userBToken);
  });

  afterAll(async () => {
    adminSocket?.close();
    userASocket?.close();
    userBSocket?.close();

    if (dataSource) {
      await dataSource.getRepository(UserRole).delete({
        userId: In(createdUserIds),
      });
      await dataSource.getRepository(User).delete({ id: In(createdUserIds) });

      const role = await dataSource
        .getRepository(Role)
        .findOneBy({ name: 'realtime_admin' });
      if (role) {
        await dataSource.getRepository(RolePermission).delete({
          roleId: role.id,
        });
        await dataSource.getRepository(UserRole).delete({ roleId: role.id });
        await dataSource.getRepository(Role).delete({ id: role.id });
      }

      if (notifPermissionCreated) {
        const permission = await dataSource
          .getRepository(Permission)
          .findOneBy({ action: 'manage', subject: 'Notification' });
        if (permission) {
          await dataSource.getRepository(Permission).delete({
            id: permission.id,
          });
        }
      }
    }

    await appA?.close();
    await appB?.close();
  });

  it('reports healthy with the redis adapter attached', async () => {
    const response = await request(appA.getHttpServer())
      .get('/api/health')
      .expect(200);
    const body = response.body as {
      status: string;
      redis: { status: string };
      redisAdapter: { status: string };
    };

    expect(body.status).toBe('ok');
    expect(body.redis.status).toBe('up');
    expect(body.redisAdapter).toEqual({ status: 'ok' });
  });

  it('disconnects a socket that does not present a valid token', async () => {
    const { socket, disconnected } = await connectSocketWithDisconnect(portA);
    const reason = await disconnected;
    expect(reason).toBeDefined();
    socket.close();
  });

  it('delivers a targeted event only to the addressed user room', async () => {
    const received = waitForEvent<BroadcastPayload>(
      userASocket,
      'user:delivery',
    );
    appA.get(NotificationsGateway).sendToUser(userAId, 'user:delivery', {
      title: 'personal',
      message: 'only user A',
    });

    await expect(received).resolves.toEqual({
      title: 'personal',
      message: 'only user A',
    });
    await expectNoEvent(userBSocket, 'user:delivery');
  });

  it('delivers across instances while keeping rooms isolated', async () => {
    // appA -> appB: user B is connected to appB.
    const receivedByB = waitForEvent<BroadcastPayload>(
      userBSocket,
      'user:delivery',
    );
    appA.get(NotificationsGateway).sendToUser(userBId, 'user:delivery', {
      title: 'across',
      message: 'to user B on the other instance',
    });
    await expect(receivedByB).resolves.toEqual(
      expect.objectContaining({ title: 'across' }),
    );
    await expectNoEvent(userASocket, 'user:delivery');

    // appB -> appA: user A is connected to appA.
    const receivedByA = waitForEvent<BroadcastPayload>(
      userASocket,
      'user:delivery',
    );
    appB.get(NotificationsGateway).sendToUser(userAId, 'user:delivery', {
      title: 'back',
      message: 'to user A on the other instance',
    });
    await expect(receivedByA).resolves.toEqual(
      expect.objectContaining({ title: 'back' }),
    );
    await expectNoEvent(userBSocket, 'user:delivery');
  });

  it('rejects a broadcast from a user without manage:Notification', async () => {
    const rejected = waitForEvent<unknown>(userASocket, 'exception');
    userASocket.emit('notifications:broadcast', {
      title: 'spam',
      message: 'not allowed',
    });

    const error = await rejected;
    expect(error).toBeDefined();

    await expectNoEvent(userBSocket, 'notifications:new');
    await expectNoEvent(adminSocket, 'notifications:new');
  });

  it('rejects a malformed broadcast payload with a validation exception', async () => {
    const rejected = waitForEvent<unknown>(adminSocket, 'exception');
    adminSocket.emit('notifications:broadcast', { title: '', message: '' });

    const error = await rejected;
    expect(error).toBeDefined();
  });

  it('broadcasts from a privileged user to every instance', async () => {
    const ack = new Promise((resolve) => {
      adminSocket.emit(
        'notifications:broadcast',
        { title: 'hello', message: 'world' },
        (response: unknown) => resolve(response),
      );
    });

    const [response, receivedByA, receivedByB] = await Promise.all([
      ack,
      waitForEvent<BroadcastPayload>(userASocket, 'notifications:new'),
      waitForEvent<BroadcastPayload>(userBSocket, 'notifications:new'),
    ]);

    expect(response).toEqual({ ok: true });
    expect(receivedByA).toEqual({ title: 'hello', message: 'world' });
    expect(receivedByB).toEqual({ title: 'hello', message: 'world' });
  });

  it('disconnects a socket once its user is deactivated mid-session', async () => {
    await dataSource
      .getRepository(User)
      .update({ id: adminUserId }, { status: UserStatus.INACTIVE });

    const disconnected = waitForDisconnect(adminSocket);
    adminSocket.emit('notifications:broadcast', {
      title: 'ghost',
      message: 'this should fail auth',
    });

    const reason = await disconnected;
    expect(reason).toBeDefined();
  });
});
