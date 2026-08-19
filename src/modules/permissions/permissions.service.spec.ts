import { BadRequestException, ConflictException } from '@nestjs/common';
import { PermissionAction } from '../../common/constants/permissions.enum';
import { PermissionSubject } from '../../common/constants/permission-subjects';
import { Permission } from './entities/permission.entity';
import { PermissionsService } from './permissions.service';

const USER_ID = 'user-1';
const CACHE_KEY = `rbac:perms:${USER_ID}`;
const RULES = [
  { action: PermissionAction.READ, subject: PermissionSubject.USER },
  { action: PermissionAction.READ, subject: PermissionSubject.ROLE },
];

describe('PermissionsService', () => {
  let service: PermissionsService;
  let redis: {
    get: jest.Mock;
    set: jest.Mock;
    del: jest.Mock;
    pipeline: jest.Mock;
  };
  let permissionRepo: {
    findOneBy: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    delete: jest.Mock;
  };
  let userRoleRepo: { find: jest.Mock; createQueryBuilder: jest.Mock };
  let loadQb: {
    select: jest.Mock;
    addSelect: jest.Mock;
    from: jest.Mock;
    innerJoin: jest.Mock;
    where: jest.Mock;
    getRawMany: jest.Mock;
  };
  let dataSource: { getRepository: jest.Mock; createQueryBuilder: jest.Mock };
  let configService: { getOrThrow: jest.Mock };

  beforeEach(() => {
    loadQb = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      distinct: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getRawMany: jest.fn(),
    };

    permissionRepo = {
      findOneBy: jest.fn(),
      save: jest.fn(),
      create: jest.fn((input: Partial<Permission>) => input),
      delete: jest.fn(),
    };

    userRoleRepo = {
      find: jest.fn(),
      createQueryBuilder: jest.fn(() => loadQb),
    };

    dataSource = {
      getRepository: jest.fn((entity: unknown) => {
        if (entity === Permission) return permissionRepo;
        return userRoleRepo;
      }),
      createQueryBuilder: jest.fn(() => loadQb),
    };

    redis = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      pipeline: jest.fn(),
    };

    configService = {
      getOrThrow: jest.fn().mockReturnValue({ accessExpiresInMs: 900_000 }),
    };

    service = new PermissionsService(
      dataSource as never,
      redis as never,
      configService as never,
    );
  });

  describe('getPermissionRulesForUser', () => {
    it('returns cached rules without hitting the database', async () => {
      redis.get.mockResolvedValue(JSON.stringify(RULES));

      await expect(service.getPermissionRulesForUser(USER_ID)).resolves.toEqual(
        RULES,
      );
      expect(dataSource.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('loads from the database and populates the cache on miss', async () => {
      redis.get.mockResolvedValue(null);
      loadQb.getRawMany.mockResolvedValue(RULES);

      await expect(service.getPermissionRulesForUser(USER_ID)).resolves.toEqual(
        RULES,
      );
      expect(redis.set).toHaveBeenCalledWith(
        CACHE_KEY,
        JSON.stringify(RULES),
        'PX',
        900_000,
      );
    });

    it('falls back to the database when the cache read fails', async () => {
      redis.get.mockRejectedValue(new Error('redis down'));
      loadQb.getRawMany.mockResolvedValue(RULES);

      await expect(service.getPermissionRulesForUser(USER_ID)).resolves.toEqual(
        RULES,
      );
    });

    it('does not fail the request when the cache write fails', async () => {
      redis.get.mockResolvedValue(null);
      redis.set.mockRejectedValue(new Error('redis down'));
      loadQb.getRawMany.mockResolvedValue(RULES);

      await expect(service.getPermissionRulesForUser(USER_ID)).resolves.toEqual(
        RULES,
      );
    });
  });

  describe('invalidation', () => {
    it('deletes a single user cache key', async () => {
      await service.invalidateUser(USER_ID);
      expect(redis.del).toHaveBeenCalledWith(CACHE_KEY);
    });

    it('finds every user id holding a role', async () => {
      userRoleRepo.find.mockResolvedValue([{ userId: 'a' }, { userId: 'b' }]);

      await expect(service.findUserIdsWithRole('role-1')).resolves.toEqual([
        'a',
        'b',
      ]);
    });

    it('finds distinct user ids reachable via a permission', async () => {
      loadQb.getRawMany.mockResolvedValue([{ userId: 'a' }]);

      await expect(
        service.findUserIdsWithPermission('permission-1'),
      ).resolves.toEqual(['a']);
      expect(loadQb.where).toHaveBeenCalledWith(
        'rp.permission_id = :permissionId',
        { permissionId: 'permission-1' },
      );
    });

    it('deletes cache keys for the given users in one pipeline', async () => {
      const pipeline = {
        del: jest.fn(),
        exec: jest.fn().mockResolvedValue([]),
      };
      redis.pipeline.mockReturnValue(pipeline);

      await service.invalidateUsers(['a', 'b']);

      expect(pipeline.del).toHaveBeenCalledTimes(2);
      expect(pipeline.del).toHaveBeenCalledWith('rbac:perms:a');
      expect(pipeline.del).toHaveBeenCalledWith('rbac:perms:b');
      expect(pipeline.exec).toHaveBeenCalled();
    });

    it('does nothing when no users are given', async () => {
      await service.invalidateUsers([]);

      expect(redis.pipeline).not.toHaveBeenCalled();
    });
  });

  describe('permission CRUD', () => {
    it('rejects a duplicate permission with 409', async () => {
      permissionRepo.findOneBy.mockResolvedValue({ id: 'existing' });

      await expect(
        service.createPermission({
          action: PermissionAction.READ,
          subject: PermissionSubject.USER,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('creates a permission when unique', async () => {
      permissionRepo.findOneBy.mockResolvedValue(null);
      permissionRepo.save.mockResolvedValue({ id: 'p-1' });

      await expect(
        service.createPermission({
          action: PermissionAction.READ,
          subject: PermissionSubject.USER,
          description: 'Read users',
        }),
      ).resolves.toEqual({ id: 'p-1' });
    });

    it('rejects an update for a missing permission', async () => {
      permissionRepo.findOneBy.mockResolvedValue(null);

      await expect(
        service.updatePermission('nope', 'desc'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('removes a permission after invalidating affected users', async () => {
      permissionRepo.findOneBy.mockResolvedValue({ id: 'p-1' });
      const userIdsSpy = jest
        .spyOn(service, 'findUserIdsWithPermission')
        .mockResolvedValue(['a']);
      const invalidateSpy = jest
        .spyOn(service, 'invalidateUsers')
        .mockResolvedValue(undefined);

      await service.removePermission('p-1');

      expect(permissionRepo.delete).toHaveBeenCalledWith('p-1');
      expect(invalidateSpy).toHaveBeenCalledWith(['a']);
      expect(permissionRepo.delete.mock.invocationCallOrder[0]).toBeLessThan(
        invalidateSpy.mock.invocationCallOrder[0],
      );
      expect(userIdsSpy.mock.invocationCallOrder[0]).toBeLessThan(
        permissionRepo.delete.mock.invocationCallOrder[0],
      );
      userIdsSpy.mockRestore();
      invalidateSpy.mockRestore();
    });
  });
});
