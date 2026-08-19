import { BadRequestException } from '@nestjs/common';
import { User } from './entities/user.entity';
import { UsersService } from './users.service';

describe('UsersService.setRoles', () => {
  let service: UsersService;
  let permissionsService: { invalidateUser: jest.Mock };
  let userRepo: { findOne: jest.Mock };
  let manager: {
    find: jest.Mock;
    delete: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
  };
  let dataSource: { transaction: jest.Mock; getRepository: jest.Mock };

  beforeEach(() => {
    permissionsService = { invalidateUser: jest.fn() };

    userRepo = { findOne: jest.fn() };

    manager = {
      find: jest.fn(),
      delete: jest.fn(),
      save: jest.fn(),
      create: jest.fn(
        (_entity: unknown, input: Record<string, unknown>) => input,
      ),
    };

    dataSource = {
      transaction: jest
        .fn()
        .mockImplementation((cb: (m: unknown) => unknown) => cb(manager)),
      getRepository: jest.fn(() => userRepo),
    };

    service = new UsersService(
      dataSource as never,
      permissionsService as never,
    );
  });

  it('rejects unknown role ids before wiping the current set', async () => {
    manager.find.mockResolvedValue([{ id: 'role-1' }]);

    await expect(
      service.setRoles('user-1', ['role-1', 'role-2']),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(manager.delete).not.toHaveBeenCalled();
    expect(permissionsService.invalidateUser).not.toHaveBeenCalled();
  });

  it('replaces the role set, deduplicates ids and invalidates the cache', async () => {
    manager.find.mockResolvedValue([{ id: 'role-1' }, { id: 'role-2' }]);
    userRepo.findOne.mockResolvedValue({ id: 'user-1', email: 'a@b.c' });

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
  });

  it('returns the updated user', async () => {
    manager.find.mockResolvedValue([{ id: 'role-1' }]);
    const user: User = { id: 'user-1', email: 'a@b.c' } as User;
    userRepo.findOne.mockResolvedValue(user);

    await expect(service.setRoles('user-1', ['role-1'])).resolves.toEqual(user);
  });
});
