import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In } from 'typeorm';
import { UserStatus } from '../../common/constants/user-status.enum';
import { PermissionsService } from '../permissions/permissions.service';
import { Role } from '../roles/entities/role.entity';
import { UserRole } from '../roles/entities/user-role.entity';
import { User } from './entities/user.entity';

const DEFAULT_ROLE_NAME = 'user';

export interface CreateUserInput {
  email: string;
  passwordHash: string;
  firstName?: string | null;
  lastName?: string | null;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly permissionsService: PermissionsService,
  ) {}

  async findByEmail(email: string): Promise<User | null> {
    return this.dataSource.getRepository(User).findOne({
      where: { email },
      relations: { userRoles: { role: true } },
    });
  }

  async findById(id: string): Promise<User | null> {
    return this.dataSource.getRepository(User).findOne({ where: { id } });
  }

  async createWithDefaultRole(input: CreateUserInput): Promise<User> {
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

      const defaultRole = await manager.findOneByOrFail(Role, {
        name: DEFAULT_ROLE_NAME,
      });

      await manager.save(
        manager.create(UserRole, {
          userId: user.id,
          roleId: defaultRole.id,
        }),
      );

      return user;
    });
  }

  async updatePassword(userId: string, passwordHash: string): Promise<void> {
    await this.dataSource.getRepository(User).update(userId, { passwordHash });
  }

  async setRoles(userId: string, roleIds: string[]): Promise<User> {
    const distinctIds = [...new Set(roleIds)];

    await this.dataSource.transaction(async (manager) => {
      if (distinctIds.length > 0) {
        // Reject unknown role ids before wiping the existing set.
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
    });

    // The user's cached permissions are now stale by definition.
    await this.permissionsService.invalidateUser(userId);

    const user = await this.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }
}
