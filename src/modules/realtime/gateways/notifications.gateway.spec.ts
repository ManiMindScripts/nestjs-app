import { ForbiddenException } from '@nestjs/common';
import { PermissionAction } from '../../../common/constants/permissions.enum';
import { PermissionSubject } from '../../../common/constants/permission-subjects';
import { createAppAbility } from '../../../common/casl/app-ability';
import { NotificationsGateway } from './notifications.gateway';

describe('NotificationsGateway', () => {
  let gateway: NotificationsGateway;
  let permissions: { getAbilityForUser: jest.Mock };
  let wsJwtGuard: { authenticate: jest.Mock };
  let correlation: { generate: jest.Mock; run: jest.Mock };
  let server: { to: jest.Mock; emit: jest.Mock };
  let toRoom: { emit: jest.Mock };
  let logSpy: jest.SpyInstance;

  const abilityFor = (rules: Parameters<typeof createAppAbility>[0]) =>
    createAppAbility(rules);

  const socket = (user?: { id: string }) =>
    ({
      id: 'socket-1',
      data: user ? { user, correlationId: 'cid' } : {},
      join: jest.fn(),
    }) as never;

  beforeEach(() => {
    permissions = { getAbilityForUser: jest.fn() };
    wsJwtGuard = { authenticate: jest.fn() };
    correlation = {
      generate: jest.fn().mockReturnValue('cid'),
      run: jest.fn((_id: string, fn: () => unknown) => fn()),
    };
    toRoom = { emit: jest.fn().mockReturnValue(true) };
    server = { to: jest.fn().mockReturnValue(toRoom), emit: jest.fn() };
    logSpy = jest.spyOn(console, 'log').mockImplementation();

    gateway = new NotificationsGateway(
      permissions as never,
      wsJwtGuard as never,
      correlation as never,
    );
    (gateway as unknown as { server: typeof server }).server = server;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    logSpy.mockRestore();
  });

  describe('broadcast', () => {
    it('broadcasts when the user holds manage:Notification', async () => {
      permissions.getAbilityForUser.mockResolvedValue(
        abilityFor([
          {
            action: PermissionAction.MANAGE,
            subject: PermissionSubject.NOTIFICATION,
          },
        ]),
      );
      const sock = socket({ id: 'user-1' });

      const result = await gateway.broadcast(
        { title: 'hi', message: 'there' },
        sock,
      );

      expect(result).toEqual({ ok: true });
      expect(server.emit).toHaveBeenCalledWith('notifications:new', {
        title: 'hi',
        message: 'there',
      });
    });

    it('rejects a user without manage:Notification with 403', async () => {
      permissions.getAbilityForUser.mockResolvedValue(abilityFor([]));
      const sock = socket({ id: 'user-1' });

      await expect(
        gateway.broadcast({ title: 'hi', message: 'there' }, sock),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(server.emit).not.toHaveBeenCalled();
    });
  });

  it('sendToUser emits only to that user room', () => {
    const ok = gateway.sendToUser('user-1', 'user:delivery', { title: 'x' });

    expect(server.to).toHaveBeenCalledWith('user:user-1');
    expect(toRoom.emit).toHaveBeenCalledWith('user:delivery', { title: 'x' });
    expect(ok).toBe(true);
  });

  describe('connection lifecycle', () => {
    it('joins the user room after a successful authentication', async () => {
      wsJwtGuard.authenticate.mockResolvedValue(true);
      const sock = socket({ id: 'user-1' });

      await gateway.handleConnection(sock);

      expect(wsJwtGuard.authenticate).toHaveBeenCalledWith(sock);
      const joined = (sock as unknown as { join: jest.Mock }).join;
      expect(joined).toHaveBeenCalledWith('user:user-1');
    });

    it('does not join a room when authentication fails', async () => {
      wsJwtGuard.authenticate.mockResolvedValue(false);
      const sock = socket({ id: 'user-1' });

      await gateway.handleConnection(sock);

      const joined = (sock as unknown as { join: jest.Mock }).join;
      expect(joined).not.toHaveBeenCalled();
    });
  });
});
