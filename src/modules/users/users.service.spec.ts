/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { UserStatus } from '../../common/constants/user-status.enum';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { PasswordResetToken } from '../auth/entities/password-reset-token.entity';
import { User } from './entities/user.entity';
import { UsersService } from './users.service';
import { UserRole } from '../roles/entities/user-role.entity';

describe('UsersService', () => {
  let service: UsersService;
  let permissionsService: { invalidateUser: jest.Mock };
  let manager: {
    find: jest.Mock;
    delete: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    softDelete: jest.Mock;
    update: jest.Mock;
    findOneByOrFail: jest.Mock;
  };
  let userRepo: {
    findOne: jest.Mock;
    find: jest.Mock;
    findAndCount: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
    create: jest.Mock;
  };
  let dataSource: { transaction: jest.Mock; getRepository: jest.Mock };

  const user = (overrides: Partial<User> = {}): User =>
    ({
      id: 'user-1',
      email: 'user@example.com',
      passwordHash: 'hash',
      firstName: null,
      lastName: null,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: null,
      createdAt: new Date(),
      ...overrides,
    }) as User;

  beforeEach(() => {
    permissionsService = { invalidateUser: jest.fn() };

    manager = {
      find: jest.fn(),
      delete: jest.fn(),
      save: jest.fn(),
      create: jest.fn(
        (_entity: unknown, input: Record<string, unknown>) => input,
      ),
      softDelete: jest.fn(),
      update: jest.fn(),
      findOneByOrFail: jest.fn(),
    };

    userRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      findAndCount: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
      create: jest.fn((input: Record<string, unknown>) => input),
    };

    dataSource = {
      transaction: jest
        .fn()
        .mockImplementation((cb: (m: unknown) => unknown) =>
          Promise.resolve(cb(manager)),
        ),
      getRepository: jest.fn(() => userRepo),
    };

    service = new UsersService(
      dataSource as never,
      permissionsService as never,
    );
  });

  describe('create', () => {
    const dto = {
      email: '  New@Example.com ',
      password: 'Password123',
      firstName: ' Jane ',
      lastName: ' Doe ',
    };

    it('normalizes input, assigns the default role, and returns the user', async () => {
      userRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValue(user({ email: 'new@example.com' }));
      manager.findOneByOrFail.mockResolvedValue({ id: 'role-user' });
      manager.save.mockResolvedValue(user({ email: 'new@example.com' }));

      const result = await service.create(dto);

      expect(manager.save).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'new@example.com',
          firstName: 'Jane',
          lastName: 'Doe',
          status: UserStatus.ACTIVE,
          passwordHash: expect.any(String),
        }),
      );
      expect(manager.save).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1', roleId: 'role-user' }),
      );
      expect(result.email).toBe('new@example.com');
    });

    it('rejects an email that belongs to an active account', async () => {
      userRepo.findOne.mockResolvedValue(user());

      await expect(service.create(dto)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('maps a concurrent unique violation to a conflict', async () => {
      userRepo.findOne.mockResolvedValue(null);
      manager.save.mockRejectedValue(
        Object.assign(new Error('duplicate key'), { code: '23505' }),
      );

      await expect(service.create(dto)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('rejects unknown role ids without creating the user', async () => {
      userRepo.findOne.mockResolvedValue(null);
      manager.save.mockResolvedValue(user());
      manager.find.mockResolvedValue([{ id: 'role-1' }]);

      await expect(
        service.create({ ...dto, roleIds: ['role-1', 'role-2'] }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('assigns the provided roles when given', async () => {
      userRepo.findOne.mockResolvedValueOnce(null).mockResolvedValue(user());
      manager.find.mockResolvedValue([{ id: 'role-1' }, { id: 'role-2' }]);
      manager.save.mockResolvedValue(user());

      await service.create({ ...dto, roleIds: ['role-1', 'role-2'] });

      expect(manager.delete).toHaveBeenCalledWith(expect.anything(), {
        userId: 'user-1',
      });
      expect(manager.save).toHaveBeenCalledWith(
        expect.anything(),
        expect.arrayContaining([
          expect.objectContaining({ userId: 'user-1', roleId: 'role-1' }),
          expect.objectContaining({ userId: 'user-1', roleId: 'role-2' }),
        ]),
      );
    });
  });

  describe('update', () => {
    it('updates name and status fields', async () => {
      const existing = user({ userRoles: [] });
      userRepo.findOne.mockResolvedValue(existing);
      userRepo.save.mockResolvedValue(existing);

      await service.update(
        'user-1',
        {
          firstName: ' John ',
          lastName: ' Smith ',
          status: UserStatus.INACTIVE,
        },
        'admin-1',
      );

      expect(existing.firstName).toBe('John');
      expect(existing.lastName).toBe('Smith');
      expect(existing.status).toBe(UserStatus.INACTIVE);
    });

    it('throws when the user does not exist', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(
        service.update('user-1', { firstName: 'John' }, 'admin-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('blocks changing your own status', async () => {
      await expect(
        service.update('user-1', { status: UserStatus.SUSPENDED }, 'user-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('allows updating your own name', async () => {
      const existing = user({ userRoles: [] });
      userRepo.findOne.mockResolvedValue(existing);
      userRepo.save.mockResolvedValue(existing);

      await expect(
        service.update('user-1', { firstName: 'John' }, 'user-1'),
      ).resolves.toBeDefined();
    });
  });

  describe('softDelete', () => {
    it('blocks deleting your own account', async () => {
      await expect(
        service.softDelete('user-1', 'user-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(manager.softDelete).not.toHaveBeenCalled();
    });

    it('throws when the user does not exist', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(
        service.softDelete('user-1', 'admin-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('soft-deletes, revokes sessions, and invalidates the permission cache', async () => {
      userRepo.findOne.mockResolvedValue(user({ userRoles: [] }));

      await service.softDelete('user-1', 'admin-1');

      expect(manager.softDelete).toHaveBeenCalledWith(
        expect.anything(),
        'user-1',
      );
      expect(manager.update).toHaveBeenCalledWith(
        RefreshToken,
        expect.objectContaining({
          userId: 'user-1',
          revokedAt: expect.anything(),
        }),
        expect.objectContaining({ revokedAt: expect.any(Date) }),
      );
      expect(manager.update).toHaveBeenCalledWith(
        PasswordResetToken,
        expect.objectContaining({
          userId: 'user-1',
          usedAt: expect.anything(),
        }),
        expect.objectContaining({ usedAt: expect.any(Date) }),
      );
      expect(permissionsService.invalidateUser).toHaveBeenCalledWith('user-1');
    });
  });

  describe('findAll', () => {
    it('paginates and loads roles for the returned page', async () => {
      const user1 = user({ id: 'user-1' });
      const user2 = user({ id: 'user-2' });
      userRepo.findAndCount.mockResolvedValue([[user1, user2], 42]);
      userRepo.find.mockResolvedValue([
        { id: 'user-1', userRoles: [{ role: { id: 'r1', name: 'user' } }] },
        { id: 'user-2', userRoles: [{ role: { id: 'r2', name: 'admin' } }] },
      ]);

      const result = await service.findAll({ page: 2, limit: 2 });

      expect(result.total).toBe(42);
      expect(result.page).toBe(2);
      expect(result.limit).toBe(2);
      expect(result.items).toHaveLength(2);
      expect(result.items[0].userRoles).toEqual([
        { role: { id: 'r1', name: 'user' } },
      ]);
      expect(userRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 2, take: 2 }),
      );
    });

    it('applies default pagination and no search', async () => {
      userRepo.findAndCount.mockResolvedValue([[], 0]);
      userRepo.find.mockResolvedValue([]);

      const result = await service.findAll({});

      expect(result.page).toBe(1);
      expect(result.limit).toBe(10);
      expect(userRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ where: undefined }),
      );
    });

    it('searches across email and names when q is provided', async () => {
      userRepo.findAndCount.mockResolvedValue([[], 0]);
      userRepo.find.mockResolvedValue([]);

      await service.findAll({ q: 'jane' });

      const where = userRepo.findAndCount.mock.calls[0][0].where;
      expect(where).toEqual([
        { email: expect.anything() },
        { firstName: expect.anything() },
        { lastName: expect.anything() },
      ]);
    });
  });

  describe('setRoles', () => {
    it('rejects unknown role ids before wiping the current set', async () => {
      manager.find.mockResolvedValue([{ id: 'role-1' }]);

      await expect(
        service.setRoles('user-1', ['role-1', 'role-2']),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(manager.delete).not.toHaveBeenCalled();
      expect(permissionsService.invalidateUser).not.toHaveBeenCalled();
    });

    it('replaces the role set, deduplicates ids, invalidates the cache, and reloads roles', async () => {
      manager.find.mockResolvedValue([{ id: 'role-1' }, { id: 'role-2' }]);
      userRepo.findOne.mockResolvedValue(
        user({
          userRoles: [
            { role: { id: 'role-1', name: 'admin' } } as unknown as UserRole,
          ],
        }),
      );

      await service.setRoles('user-1', ['role-1', 'role-2', 'role-1']);

      expect(manager.delete).toHaveBeenCalledWith(expect.anything(), {
        userId: 'user-1',
      });
      expect(manager.save).toHaveBeenCalledWith(
        expect.anything(),
        expect.arrayContaining([
          expect.objectContaining({ userId: 'user-1', roleId: 'role-1' }),
          expect.objectContaining({ userId: 'user-1', roleId: 'role-2' }),
        ]),
      );
      expect(permissionsService.invalidateUser).toHaveBeenCalledWith('user-1');
      expect(userRepo.findOne).toHaveBeenCalledTimes(1);
    });
  });
});
