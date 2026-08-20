import { ExecutionContext } from '@nestjs/common';
import { UserStatus } from '../constants/user-status.enum';
import { WsJwtGuard } from './ws-jwt.guard';

describe('WsJwtGuard', () => {
  const identity = { verifyToken: jest.fn() };
  let guard: WsJwtGuard;
  let socket: {
    id: string;
    data: Record<string, unknown>;
    handshake: {
      auth: { token?: string };
      headers: { authorization?: string };
    };
    disconnect: jest.Mock;
  };

  const makeSocket = (authToken?: string, authorization?: string) => ({
    id: 'socket-1',
    data: {},
    handshake: {
      auth: authToken ? { token: authToken } : {},
      headers: authorization ? { authorization } : {},
    },
    disconnect: jest.fn(),
  });

  const makeContext = (client: typeof socket): ExecutionContext =>
    ({
      switchToWs: () => ({ getClient: () => client }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    identity.verifyToken.mockReset();
    guard = new WsJwtGuard(identity as never);
    socket = makeSocket();
  });

  it('attaches the verified user and allows the connection', async () => {
    socket = makeSocket('valid-token');
    const context = makeContext(socket);
    const user = { id: 'user-1', status: UserStatus.ACTIVE };
    identity.verifyToken.mockResolvedValue(user);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(socket.data.user).toBe(user);
    expect(socket.disconnect).not.toHaveBeenCalled();
  });

  it('disconnects when no token is present', async () => {
    const context = makeContext(socket);

    await expect(guard.canActivate(context)).resolves.toBe(false);
    expect(socket.disconnect).toHaveBeenCalled();
  });

  it('reads the bearer header as a fallback transport', async () => {
    socket = makeSocket(undefined, 'Bearer header-token');
    const context = makeContext(socket);
    identity.verifyToken.mockResolvedValue({ id: 'user-1' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(identity.verifyToken).toHaveBeenCalledWith('header-token');
  });

  it('disconnects when token verification fails', async () => {
    socket = makeSocket('bad-token');
    const context = makeContext(socket);
    identity.verifyToken.mockRejectedValue(new Error('unauthorized'));

    await expect(guard.canActivate(context)).resolves.toBe(false);
    expect(socket.disconnect).toHaveBeenCalled();
  });
});
