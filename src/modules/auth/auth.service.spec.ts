/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { UserStatus } from '../../common/constants/user-status.enum';
import { hashPassword } from '../../common/utils/password';
import { User } from '../users/entities/user.entity';
import { AuthService } from './auth.service';
import { RefreshToken } from './entities/refresh-token.entity';

describe('AuthService', () => {
  let service: AuthService;
  let refreshTokenRepository: {
    findOne: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  let passwordResetTokenRepository: {
    findOne: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  let manager: {
    findOne: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  let dataSource: { transaction: jest.Mock };
  let usersService: {
    findByEmail: jest.Mock;
    findById: jest.Mock;
    createWithDefaultRole: jest.Mock;
    updatePassword: jest.Mock;
  };
  let jwtService: { signAsync: jest.Mock };
  let mailService: { sendPasswordReset: jest.Mock };
  let configService: { getOrThrow: jest.Mock };

  const user = {
    id: 'user-1',
    email: 'user@example.com',
    passwordHash: 'hash',
    firstName: null,
    lastName: null,
    status: UserStatus.ACTIVE,
    emailVerifiedAt: null,
    createdAt: new Date(),
  } as User;

  const jwtConfigMock = {
    accessSecret: 'secret',
    accessExpiresIn: '15m',
    accessExpiresInMs: 900_000,
    refreshExpiresIn: '7d',
    refreshExpiresInMs: 604_800_000,
    cookieName: 'refresh_token',
    cookiePath: '/api/auth',
    cookieSecure: false,
    cookieSameSite: 'lax',
    resetTokenTtl: '30m',
    resetTokenTtlMs: 1_800_000,
  };

  beforeEach(() => {
    refreshTokenRepository = {
      findOne: jest.fn(),
      save: jest.fn(),
      create: jest.fn((data) => data),
      update: jest.fn().mockResolvedValue(undefined),
    };
    passwordResetTokenRepository = {
      findOne: jest.fn(),
      save: jest.fn(),
      create: jest.fn((data) => data),
      update: jest.fn().mockResolvedValue(undefined),
    };
    manager = {
      findOne: jest.fn(),
      save: jest.fn(),
      create: jest.fn((_entityClass, data) => data),
      update: jest.fn().mockResolvedValue(undefined),
    };
    dataSource = {
      transaction: jest
        .fn()
        .mockImplementation((callback: (m: unknown) => unknown) =>
          Promise.resolve(callback(manager)),
        ),
    };
    usersService = {
      findByEmail: jest.fn(),
      findById: jest.fn(),
      createWithDefaultRole: jest.fn(),
      updatePassword: jest.fn().mockResolvedValue(undefined),
    };
    jwtService = { signAsync: jest.fn().mockResolvedValue('access-token') };
    mailService = { sendPasswordReset: jest.fn().mockResolvedValue(undefined) };
    configService = { getOrThrow: jest.fn().mockReturnValue(jwtConfigMock) };

    service = new AuthService(
      refreshTokenRepository,
      passwordResetTokenRepository,
      dataSource,
      usersService,
      jwtService,
      mailService,
      configService,
    );
  });

  describe('register', () => {
    it('normalizes the email, creates the user with a default role, and establishes a session', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      usersService.createWithDefaultRole.mockResolvedValue(user);
      refreshTokenRepository.save.mockResolvedValue({ id: 'rt-1' });

      const result = await service.register(
        { email: '  User@Example.com ', password: 'Password123' },
        { ipAddress: '1.2.3.4' },
      );

      expect(usersService.findByEmail).toHaveBeenCalledWith('user@example.com');
      expect(usersService.createWithDefaultRole).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'user@example.com',
          firstName: null,
          lastName: null,
          passwordHash: expect.any(String),
        }),
      );
      expect(refreshTokenRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          familyId: expect.any(String),
          ipAddress: '1.2.3.4',
        }),
      );
      expect(result).toEqual(
        expect.objectContaining({
          accessToken: 'access-token',
          refreshToken: expect.any(String),
        }),
      );
      expect(result.user.passwordHash).toBeUndefined();
    });

    it('rejects a duplicate email', async () => {
      usersService.findByEmail.mockResolvedValue(user);

      await expect(
        service.register(
          { email: 'user@example.com', password: 'Password123' },
          {},
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('login', () => {
    it('issues a session for valid credentials', async () => {
      usersService.findByEmail.mockResolvedValue({
        ...user,
        passwordHash: await hashPassword('Password123'),
      });
      refreshTokenRepository.save.mockResolvedValue({ id: 'rt-1' });

      const result = await service.login(
        { email: 'user@example.com', password: 'Password123' },
        {},
      );

      expect(result.accessToken).toBe('access-token');
      expect(refreshTokenRepository.save).toHaveBeenCalled();
    });

    it('rejects an unknown email without revealing it', async () => {
      usersService.findByEmail.mockResolvedValue(null);

      await expect(
        service.login({ email: 'ghost@example.com', password: 'x' }, {}),
      ).rejects.toThrow(UnauthorizedException);
      expect(refreshTokenRepository.save).not.toHaveBeenCalled();
    });

    it('rejects a wrong password', async () => {
      usersService.findByEmail.mockResolvedValue({
        ...user,
        passwordHash: await hashPassword('RightPassword123'),
      });

      await expect(
        service.login({ email: 'user@example.com', password: 'Wrong' }, {}),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects an inactive account even with valid credentials', async () => {
      usersService.findByEmail.mockResolvedValue({
        ...user,
        status: UserStatus.SUSPENDED,
        passwordHash: await hashPassword('Password123'),
      });

      await expect(
        service.login(
          { email: 'user@example.com', password: 'Password123' },
          {},
        ),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('refresh', () => {
    const storedToken = {
      id: 'old-token',
      familyId: 'fam-1',
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      usedAt: null,
    };

    const mockFindOneForToken = (token: Record<string, unknown>) =>
      manager.findOne.mockImplementation((entity: unknown) =>
        entity === User ? user : token,
      );

    it('rotates the presented token and invalidates it', async () => {
      mockFindOneForToken(storedToken);
      manager.save.mockResolvedValue({ id: 'new-token' });

      const result = await service.refresh('raw-token', {});

      expect(dataSource.transaction).toHaveBeenCalled();
      expect(manager.findOne).toHaveBeenCalledWith(
        RefreshToken,
        expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
      );
      expect(manager.save).toHaveBeenCalledWith(
        expect.objectContaining({ familyId: 'fam-1' }),
      );
      expect(manager.update).toHaveBeenCalledWith(
        RefreshToken,
        'old-token',
        expect.objectContaining({
          usedAt: expect.any(Date),
          revokedAt: expect.any(Date),
          replacedByTokenId: 'new-token',
        }),
      );
      expect(result.accessToken).toBe('access-token');
      expect(result.refreshToken).toEqual(expect.any(String));
    });

    it('revokes the whole family when an already-rotated token is reused', async () => {
      mockFindOneForToken({
        ...storedToken,
        revokedAt: new Date(),
        usedAt: new Date(),
      });

      await expect(service.refresh('raw-token', {})).rejects.toThrow(
        UnauthorizedException,
      );

      expect(manager.update).toHaveBeenCalledWith(
        RefreshToken,
        expect.objectContaining({ familyId: 'fam-1' }),
        expect.objectContaining({ revokedAt: expect.any(Date) }),
      );
    });

    it('rejects an expired token', async () => {
      mockFindOneForToken({
        ...storedToken,
        expiresAt: new Date(Date.now() - 60_000),
      });

      await expect(service.refresh('raw-token', {})).rejects.toThrow(
        UnauthorizedException,
      );
      expect(manager.update).toHaveBeenCalledWith(
        RefreshToken,
        'old-token',
        expect.objectContaining({ revokedAt: expect.any(Date) }),
      );
    });

    it('rejects a missing token', async () => {
      await expect(service.refresh(undefined, {})).rejects.toThrow(
        UnauthorizedException,
      );
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    it('revokes only the presented token', async () => {
      refreshTokenRepository.findOne.mockResolvedValue({
        id: 'token-1',
        revokedAt: null,
      });

      await service.logout('raw-token');

      expect(refreshTokenRepository.update).toHaveBeenCalledWith(
        'token-1',
        expect.objectContaining({ revokedAt: expect.any(Date) }),
      );
    });

    it('is a no-op without a token or when already revoked', async () => {
      await service.logout(undefined);
      expect(refreshTokenRepository.findOne).not.toHaveBeenCalled();

      refreshTokenRepository.findOne.mockResolvedValue({
        id: 'token-1',
        revokedAt: new Date(),
      });
      await service.logout('raw-token');
      expect(refreshTokenRepository.update).not.toHaveBeenCalled();
    });
  });

  describe('forgotPassword', () => {
    it('stores a hashed reset token and emails the link', async () => {
      usersService.findByEmail.mockResolvedValue(user);
      passwordResetTokenRepository.save.mockResolvedValue({ id: 'prt-1' });

      await service.forgotPassword(
        { email: 'user@example.com' },
        { ipAddress: '1.2.3.4' },
      );

      const created = passwordResetTokenRepository.create.mock.calls[0][0];
      expect(created.userId).toBe('user-1');
      expect(created.tokenHash).toMatch(/^[a-f0-9]{64}$/);
      expect(created.ipAddress).toBe('1.2.3.4');
      expect(mailService.sendPasswordReset).toHaveBeenCalledWith(
        'user@example.com',
        expect.stringMatching(/^[a-f0-9]{64}$/),
      );
      // Pending previous reset tokens are invalidated.
      expect(passwordResetTokenRepository.update).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1' }),
        { usedAt: expect.any(Date) },
      );
    });

    it('never reveals whether an email is registered', async () => {
      usersService.findByEmail.mockResolvedValue(null);

      await expect(
        service.forgotPassword({ email: 'ghost@example.com' }, {}),
      ).resolves.toBeUndefined();
      expect(mailService.sendPasswordReset).not.toHaveBeenCalled();
    });
  });

  describe('resetPassword', () => {
    it('updates the password and revokes all active sessions', async () => {
      passwordResetTokenRepository.findOne.mockResolvedValue({
        id: 'prt-1',
        usedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
        user,
      });

      await service.resetPassword({
        token: 'a'.repeat(64),
        newPassword: 'NewPassword456',
      });

      expect(usersService.updatePassword).toHaveBeenCalledWith(
        'user-1',
        expect.any(String),
      );
      expect(passwordResetTokenRepository.update).toHaveBeenCalledWith(
        'prt-1',
        { usedAt: expect.any(Date) },
      );
      expect(refreshTokenRepository.update).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1' }),
        expect.objectContaining({ revokedAt: expect.any(Date) }),
      );
    });

    it('rejects an already-used token', async () => {
      passwordResetTokenRepository.findOne.mockResolvedValue({
        id: 'prt-1',
        usedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
        user,
      });

      await expect(
        service.resetPassword({
          token: 'a'.repeat(64),
          newPassword: 'NewPassword456',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(usersService.updatePassword).not.toHaveBeenCalled();
    });

    it('rejects an expired token', async () => {
      passwordResetTokenRepository.findOne.mockResolvedValue({
        id: 'prt-1',
        usedAt: null,
        expiresAt: new Date(Date.now() - 60_000),
        user,
      });

      await expect(
        service.resetPassword({
          token: 'a'.repeat(64),
          newPassword: 'NewPassword456',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
