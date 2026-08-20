import { UnauthorizedException } from '@nestjs/common';
import { UserStatus } from '../constants/user-status.enum';
import { AccessTokenIdentityService } from './access-token-identity.service';

describe('AccessTokenIdentityService', () => {
  const jwtService = { verifyAsync: jest.fn() };
  const usersService = { findById: jest.fn() };
  let service: AccessTokenIdentityService;

  const user = {
    id: 'user-1',
    email: 'user@example.com',
    status: UserStatus.ACTIVE,
  };

  beforeEach(() => {
    jwtService.verifyAsync.mockReset();
    usersService.findById.mockReset();
    service = new AccessTokenIdentityService(
      jwtService as never,
      usersService as never,
    );
  });

  it('resolves an active user from a valid token', async () => {
    jwtService.verifyAsync.mockResolvedValue({
      sub: 'user-1',
      email: 'user@example.com',
    });
    usersService.findById.mockResolvedValue(user);

    await expect(service.verifyToken('token')).resolves.toBe(user);
    expect(usersService.findById).toHaveBeenCalledWith('user-1');
  });

  it('rejects an invalid token signature', async () => {
    jwtService.verifyAsync.mockRejectedValue(new Error('jwt expired'));

    await expect(service.verifyToken('bad')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a token without a subject', async () => {
    jwtService.verifyAsync.mockResolvedValue({ email: 'user@example.com' });

    await expect(service.verifyToken('token')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a token for a missing user', async () => {
    jwtService.verifyAsync.mockResolvedValue({ sub: 'user-1' });
    usersService.findById.mockResolvedValue(null);

    await expect(service.verifyToken('token')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a token for an inactive user', async () => {
    usersService.findById.mockResolvedValue({
      ...user,
      status: UserStatus.SUSPENDED,
    });

    await expect(service.findActiveUserById('user-1')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('returns an active user by id', async () => {
    usersService.findById.mockResolvedValue(user);

    await expect(service.findActiveUserById('user-1')).resolves.toBe(user);
  });
});
