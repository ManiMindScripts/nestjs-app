import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, ILike, In, IsNull } from 'typeorm';
import { UserStatus } from '../../common/constants/user-status.enum';
import { isUniqueViolation } from '../../common/utils/db';
import { hashPassword } from '../../common/utils/password';
import { PasswordResetToken } from '../auth/entities/password-reset-token.entity';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { PermissionsService } from '../permissions/permissions.service';
import { Role } from '../roles/entities/role.entity';
import { UserRole } from '../roles/entities/user-role.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { User } from './entities/user.entity';

const DEFAULT_ROLE_NAME = 'user';

export interface CreateUserInput {
  email: string;
  passwordHash: string;
  firstName?: string | null;
  lastName?: string | null;
}

const USER_RELATIONS = { userRoles: { role: true } } as const;

@Injectable()
export class UsersService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly permissionsService: PermissionsService,
  ) {}

  async findByEmail(email: string): Promise<User | null> {
    return this.dataSource.getRepository(User).findOne({
      where: { email },
      relations: USER_RELATIONS,
    });
  }

  async findById(id: string): Promise<User | null> {
    return this.dataSource.getRepository(User).findOne({ where: { id } });
  }

  async findWithRolesById(id: string): Promise<User | null> {
    return this.dataSource.getRepository(User).findOne({
      where: { id },
      relations: USER_RELATIONS,
    });
  }

  async findWithRolesOrFail(id: string): Promise<User> {
    const user = await this.findWithRolesById(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async findAll(query: ListUsersQueryDto): Promise<{
    items: User[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const q = query.q?.trim();

    const repo = this.dataSource.getRepository(User);
    const where = q
      ? [
          { email: ILike(`%${q}%`) },
          { firstName: ILike(`%${q}%`) },
          { lastName: ILike(`%${q}%`) },
        ]
      : undefined;

    const [items, total] = await repo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    const rolesById = new Map(
      (await this.loadUsersWithRoles(items.map((user) => user.id))).map(
        (user) => [user.id, user.userRoles],
      ),
    );

    return {
      items: items.map((user) => ({
        ...user,
        userRoles: rolesById.get(user.id) ?? [],
      })),
      total,
      page,
      limit,
    };
  }

  async createWithDefaultRole(input: CreateUserInput): Promise<User> {
    return this.createUserInTransaction(input, undefined);
  }

  async create(dto: CreateUserDto): Promise<User> {
    const email = dto.email.trim().toLowerCase();

    if (await this.findByEmail(email)) {
      throw new ConflictException('Email is already registered');
    }

    const passwordHash = await hashPassword(dto.password);
    try {
      const created = await this.createUserInTransaction(
        {
          email,
          passwordHash,
          firstName: dto.firstName?.trim() || null,
          lastName: dto.lastName?.trim() || null,
        },
        dto.roleIds,
      );
      return this.findWithRolesOrFail(created.id);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('Email is already registered');
      }
      throw error;
    }
  }

  async update(
    id: string,
    dto: UpdateUserDto,
    actingUserId: string | undefined,
  ): Promise<User> {
    if (id === actingUserId && dto.status !== undefined) {
      throw new BadRequestException('Cannot change your own status');
    }

    const user = await this.findWithRolesOrFail(id);
    if (dto.firstName !== undefined) {
      user.firstName = dto.firstName.trim() || null;
    }
    if (dto.lastName !== undefined) {
      user.lastName = dto.lastName.trim() || null;
    }
    if (dto.status !== undefined) {
      user.status = dto.status;
    }

    await this.dataSource.getRepository(User).save(user);
    return this.findWithRolesOrFail(id);
  }

  async softDelete(
    id: string,
    actingUserId: string | undefined,
  ): Promise<void> {
    if (id === actingUserId) {
      throw new BadRequestException('Cannot delete your own account');
    }

    await this.findWithRolesOrFail(id);

    await this.dataSource.transaction(async (manager) => {
      await manager.softDelete(User, id);
      await manager.update(
        RefreshToken,
        { userId: id, revokedAt: IsNull() },
        { revokedAt: new Date() },
      );
      await manager.update(
        PasswordResetToken,
        { userId: id, usedAt: IsNull() },
        { usedAt: new Date() },
      );
    });

    await this.permissionsService.invalidateUser(id);
  }

  async updatePassword(userId: string, passwordHash: string): Promise<void> {
    await this.dataSource.getRepository(User).update(userId, { passwordHash });
  }

  async setRoles(userId: string, roleIds: string[]): Promise<User> {
    await this.dataSource.transaction(async (manager) => {
      await this.assignRoles(manager, userId, roleIds);
    });

    await this.permissionsService.invalidateUser(userId);

    return this.findWithRolesOrFail(userId);
  }

  private async createUserInTransaction(
    input: CreateUserInput,
    roleIds: string[] | undefined,
  ): Promise<User> {
    return this.dataSource.transaction(async (manager) => {
      const user = await manager.save(
        manager.create(User, {
          email: input.email,
          passwordHash: input.passwordHash,
          firstName: input.firstName ?? null,
          lastName: input.lastName ?? null,
          status: UserStatus.ACTIVE,
        }),
      );

      if (roleIds?.length) {
        await this.assignRoles(manager, user.id, roleIds);
      } else {
        const defaultRole = await manager.findOneByOrFail(Role, {
          name: DEFAULT_ROLE_NAME,
        });
        await manager.save(
          manager.create(UserRole, {
            userId: user.id,
            roleId: defaultRole.id,
          }),
        );
      }

      return user;
    });
  }

  private async assignRoles(
    manager: EntityManager,
    userId: string,
    roleIds: string[],
  ): Promise<void> {
    const distinctIds = [...new Set(roleIds)];
    if (distinctIds.length > 0) {
      // Reject unknown role ids before wiping the existing set: a typo'd id
      // must never silently succeed and grant nothing.
      const existing = await manager.find(Role, {
        where: { id: In(distinctIds) },
        select: { id: true },
      });
      if (existing.length !== distinctIds.length) {
        const found = new Set(existing.map((role) => role.id));
        const missing = distinctIds.filter((roleId) => !found.has(roleId));
        throw new BadRequestException(
          `Unknown role id(s): ${missing.join(', ')}`,
        );
      }
    }

    await manager.delete(UserRole, { userId });
    if (distinctIds.length > 0) {
      await manager.save(
        UserRole,
        distinctIds.map((roleId) =>
          manager.create(UserRole, { userId, roleId }),
        ),
      );
    }
  }

  private async loadUsersWithRoles(ids: string[]): Promise<User[]> {
    if (ids.length === 0) {
      return [];
    }
    return this.dataSource.getRepository(User).find({
      where: { id: In(ids) },
      relations: USER_RELATIONS,
    });
  }
}
