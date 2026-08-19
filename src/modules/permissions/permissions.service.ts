import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { Redis } from 'ioredis';
import { DataSource } from 'typeorm';
import { createAppAbility, AppAbility } from '../../common/casl/app-ability';
import {
  PermissionAction,
  PermissionRule,
} from '../../common/constants/permissions.enum';
import { PermissionSubjectValue } from '../../common/constants/permission-subjects';
import { JwtConfig } from '../../config/jwt.config';
import { REDIS_CLIENT } from '../../shared/redis/redis.module';
import { UserRole } from '../roles/entities/user-role.entity';
import { Permission } from './entities/permission.entity';
import { RolePermission } from './entities/role-permission.entity';

const CACHE_PREFIX = 'rbac:perms:';

export interface CreatePermissionInput {
  action: PermissionAction;
  subject: PermissionSubjectValue;
  description?: string | null;
}

@Injectable()
export class PermissionsService {
  private readonly logger = new Logger(PermissionsService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly configService: ConfigService,
  ) {}

  private get cacheTtlMs(): number {
    return this.configService.getOrThrow<JwtConfig>('jwt').accessExpiresInMs;
  }

  async getPermissionRulesForUser(userId: string): Promise<PermissionRule[]> {
    const cacheKey = this.cacheKey(userId);

    const cached = await this.safeGet(cacheKey);
    if (cached) {
      return cached;
    }

    const rules = await this.loadPermissionRules(userId);
    await this.safeSet(cacheKey, rules);
    return rules;
  }

  async getAbilityForUser(userId: string): Promise<AppAbility> {
    return createAppAbility(await this.getPermissionRulesForUser(userId));
  }

  async invalidateUser(userId: string): Promise<void> {
    await this.safeDel(this.cacheKey(userId));
  }

  async findUserIdsWithRole(roleId: string): Promise<string[]> {
    const rows = await this.dataSource.getRepository(UserRole).find({
      where: { roleId },
      select: { userId: true },
    });
    return rows.map((row) => row.userId);
  }

  async findUserIdsWithPermission(permissionId: string): Promise<string[]> {
    const rows = await this.dataSource
      .getRepository(UserRole)
      .createQueryBuilder('ur')
      .innerJoin(RolePermission, 'rp', 'rp.role_id = ur.role_id')
      .select('ur.userId', 'userId')
      .distinct(true)
      .where('rp.permission_id = :permissionId', { permissionId })
      .getRawMany<{ userId: string }>();
    return rows.map((row) => row.userId);
  }

  async invalidateUsers(userIds: string[]): Promise<void> {
    await this.safeDelBatch(userIds.map((userId) => this.cacheKey(userId)));
  }

  async findAllPermissions(): Promise<Permission[]> {
    return this.dataSource.getRepository(Permission).find({
      order: { subject: 'ASC', action: 'ASC' },
    });
  }

  async findPermissionById(id: string): Promise<Permission | null> {
    return this.dataSource.getRepository(Permission).findOneBy({ id });
  }

  async createPermission(input: CreatePermissionInput): Promise<Permission> {
    await this.assertUniquePermission(input.action, input.subject);

    try {
      return await this.dataSource.getRepository(Permission).save(
        this.dataSource.getRepository(Permission).create({
          action: input.action,
          subject: input.subject,
          description: input.description ?? null,
        }),
      );
    } catch (error) {
      this.handleUniqueViolation(error, `${input.action}:${input.subject}`);
    }
  }

  async updatePermission(
    id: string,
    description: string | null,
  ): Promise<Permission> {
    const permission = await this.findPermissionById(id);
    if (!permission) {
      throw new BadRequestException('Permission not found');
    }

    permission.description = description;
    return this.dataSource.getRepository(Permission).save(permission);
  }

  async removePermission(id: string): Promise<void> {
    const permission = await this.findPermissionById(id);
    if (!permission) {
      throw new BadRequestException('Permission not found');
    }

    // Capture affected users BEFORE the delete (the join through
    // role_permissions is gone afterwards), then invalidate AFTER the delete
    // so a concurrent re-cache reflects the removed permission instead of
    // re-introducing stale rules.
    const userIds = await this.findUserIdsWithPermission(id);
    await this.dataSource.getRepository(Permission).delete(id);
    await this.invalidateUsers(userIds);
  }

  private async loadPermissionRules(userId: string): Promise<PermissionRule[]> {
    const rows = await this.dataSource
      .createQueryBuilder()
      .select('p.action', 'action')
      .addSelect('p.subject', 'subject')
      .distinct(true)
      .from(Permission, 'p')
      .innerJoin(RolePermission, 'rp', 'rp.permission_id = p.id')
      .innerJoin(UserRole, 'ur', 'ur.role_id = rp.role_id')
      .where('ur.user_id = :userId', { userId })
      .getRawMany<{ action: string; subject: string }>();

    return rows.map((row) => ({
      action: row.action as PermissionAction,
      subject: row.subject as PermissionSubjectValue,
    }));
  }

  private async assertUniquePermission(
    action: PermissionAction,
    subject: PermissionSubjectValue,
  ): Promise<void> {
    const existing = await this.dataSource
      .getRepository(Permission)
      .findOneBy({ action, subject });
    if (existing) {
      throw new ConflictException(
        `Permission "${action}:${subject}" already exists`,
      );
    }
  }

  private handleUniqueViolation(error: unknown, key: string): never {
    if (
      error instanceof Error &&
      'code' in error &&
      (error as { code?: string }).code === '23505'
    ) {
      throw new ConflictException(`Permission "${key}" already exists`);
    }
    throw error;
  }

  private async safeGet(key: string): Promise<PermissionRule[] | null> {
    try {
      const raw = await this.redis.get(key);
      if (!raw) {
        return null;
      }
      return JSON.parse(raw) as PermissionRule[];
    } catch (error) {
      this.logger.warn(
        `Permission cache read failed for ${key}`,
        String(error),
      );
      return null;
    }
  }

  private async safeSet(key: string, rules: PermissionRule[]): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(rules), 'PX', this.cacheTtlMs);
    } catch (error) {
      this.logger.warn(
        `Permission cache write failed for ${key}`,
        String(error),
      );
    }
  }

  private async safeDel(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch (error) {
      this.logger.warn(
        `Permission cache delete failed for ${key}`,
        String(error),
      );
    }
  }

  private async safeDelBatch(keys: string[]): Promise<void> {
    if (keys.length === 0) {
      return;
    }
    try {
      const pipeline = this.redis.pipeline();
      keys.forEach((key) => pipeline.del(key));
      await pipeline.exec();
    } catch (error) {
      this.logger.warn(
        `Permission cache batch delete failed for ${keys.length} keys`,
        String(error),
      );
    }
  }

  private cacheKey(userId: string): string {
    return `${CACHE_PREFIX}${userId}`;
  }
}
