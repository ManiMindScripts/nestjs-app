import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Role } from './entities/role.entity';
import { RolesService } from './roles.service';

const role = (overrides: Partial<Role> = {}): Role =>
  ({
    id: 'role-1',
    name: 'editor',
    description: null,
    isSystem: false,
    rolePermissions: [],
    ...overrides,
  }) as Role;

describe('RolesService', () => {
  let service: RolesService;
  let roleRepository: {
    find: jest.Mock;
    findOne: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    existsBy: jest.Mock;
    delete: jest.Mock;
  };
  let rolePermissionRepository: Record<string, jest.Mock>;
  let permissionsService: {
    findUserIdsWithRole: jest.Mock;
    invalidateUsers: jest.Mock;
  };
  let manager: {
    find: jest.Mock;
    delete: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
  };
  let dataSource: { transaction: jest.Mock };

  beforeEach(() => {
    roleRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
      save: jest.fn(),
      create: jest.fn((input: Partial<Role>) => input),
      existsBy: jest.fn(),
      delete: jest.fn(),
    };

    rolePermissionRepository = {};
    permissionsService = {
      findUserIdsWithRole: jest.fn(),
      invalidateUsers: jest.fn(),
    };

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
    };

    service = new RolesService(
      roleRepository as never,
      rolePermissionRepository as never,
      dataSource as never,
      permissionsService as never,
    );
  });

  it('creates a non-system role', async () => {
    roleRepository.existsBy.mockResolvedValue(false);
    roleRepository.save.mockResolvedValue({ id: 'role-1' });
    roleRepository.findOne.mockResolvedValue(role());

    await expect(
      service.create({ name: 'editor', description: 'Editors' }),
    ).resolves.toMatchObject({ name: 'editor' });
    expect(roleRepository.create).toHaveBeenCalledWith({
      name: 'editor',
      description: 'Editors',
      isSystem: false,
    });
  });

  it('rejects a duplicate role name with 409', async () => {
    roleRepository.existsBy.mockResolvedValue(true);

    await expect(service.create({ name: 'admin' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('maps a concurrent unique-violation on create to 409', async () => {
    roleRepository.existsBy.mockResolvedValue(false);
    roleRepository.save.mockRejectedValue(
      Object.assign(new Error('duplicate key value'), { code: '23505' }),
    );

    await expect(service.create({ name: 'editor' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('rejects updating a system role with 403', async () => {
    roleRepository.findOne.mockResolvedValue(role({ isSystem: true }));

    await expect(
      service.update('role-1', { name: 'root' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects renaming to an existing role name with 409', async () => {
    roleRepository.findOne.mockResolvedValue(role());
    roleRepository.existsBy.mockResolvedValue(true);

    await expect(
      service.update('role-1', { name: 'admin' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('removes a role, invalidating affected users only after the delete', async () => {
    roleRepository.findOne.mockResolvedValue(role());
    permissionsService.findUserIdsWithRole.mockResolvedValue(['a', 'b']);

    await service.remove('role-1');

    expect(permissionsService.findUserIdsWithRole).toHaveBeenCalledWith(
      'role-1',
    );
    expect(roleRepository.delete).toHaveBeenCalledWith('role-1');
    expect(permissionsService.invalidateUsers).toHaveBeenCalledWith(['a', 'b']);
    expect(roleRepository.delete.mock.invocationCallOrder[0]).toBeLessThan(
      permissionsService.invalidateUsers.mock.invocationCallOrder[0],
    );
  });

  it('rejects deleting a system role with 403', async () => {
    roleRepository.findOne.mockResolvedValue(role({ isSystem: true }));

    await expect(service.remove('role-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rejects setting permissions on a system role with 403', async () => {
    roleRepository.findOne.mockResolvedValue(role({ isSystem: true }));

    await expect(
      service.setPermissions('role-1', ['p-1']),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a permission set containing unknown ids', async () => {
    roleRepository.findOne.mockResolvedValue(role());
    manager.find.mockResolvedValue([{ id: 'p-1' }]);

    await expect(
      service.setPermissions('role-1', ['p-1', 'p-2']),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(manager.delete).not.toHaveBeenCalled();
  });

  it('replaces the permission set and invalidates affected users', async () => {
    roleRepository.findOne.mockResolvedValue(role());
    manager.find.mockResolvedValue([{ id: 'p-1' }, { id: 'p-2' }]);
    permissionsService.findUserIdsWithRole.mockResolvedValue(['a']);

    await service.setPermissions('role-1', ['p-1', 'p-2', 'p-1']);

    expect(manager.delete).toHaveBeenCalledWith(expect.anything(), {
      roleId: 'role-1',
    });
    expect(manager.save).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([
        expect.objectContaining({ roleId: 'role-1', permissionId: 'p-1' }),
        expect.objectContaining({ roleId: 'role-1', permissionId: 'p-2' }),
      ]),
    );
    expect(permissionsService.findUserIdsWithRole).toHaveBeenCalledWith(
      'role-1',
    );
    expect(permissionsService.invalidateUsers).toHaveBeenCalledWith(['a']);
  });
});
