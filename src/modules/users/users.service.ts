import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { UserStatus } from '../../common/constants/user-status.enum';
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
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

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
}
