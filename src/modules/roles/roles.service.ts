import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { isUniqueViolation } from '../../common/utils/db';
import { PermissionsService } from '../permissions/permissions.service';
import { Permission } from '../permissions/entities/permission.entity';
import { Role } from './entities/role.entity';
import { RolePermission } from '../permissions/entities/role-permission.entity';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';

@Injectable()
export class RolesService {
  constructor(
    @InjectRepository(Role) private readonly roleRepository: Repository<Role>,
    @InjectRepository(RolePermission)
    private readonly rolePermissionRepository: Repository<RolePermission>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly permissionsService: PermissionsService,
  ) {}

  async findAll(): Promise<Role[]> {
    return this.roleRepository.find({
      relations: { rolePermissions: { permission: true } },
      order: { name: 'ASC' },
    });
  }

  async findById(id: string): Promise<Role | null> {
    return this.roleRepository.findOne({
      where: { id },
      relations: { rolePermissions: { permission: true } },
    });
  }

  async create(dto: CreateRoleDto): Promise<Role> {
    const name = dto.name.trim();
    if (await this.roleRepository.existsBy({ name })) {
      throw new ConflictException(`Role "${name}" already exists`);
    }

    try {
      const role = await this.roleRepository.save(
        this.roleRepository.create({
          name,
          description: dto.description?.trim() || null,
          isSystem: false,
        }),
      );

      return this.getOrThrow(role.id);
    } catch (error) {
      this.handleUniqueViolation(error, name);
    }
  }

  async update(id: string, dto: UpdateRoleDto): Promise<Role> {
    const role = await this.getOrThrow(id);
    this.assertMutable(role, 'update');

    let currentName = role.name;

    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (name !== role.name) {
        if (await this.roleRepository.existsBy({ name })) {
          throw new ConflictException(`Role "${name}" already exists`);
        }
        role.name = name;
        currentName = name;
      }
    }

    if (dto.description !== undefined) {
      role.description = dto.description?.trim() || null;
    }

    try {
      await this.roleRepository.save(role);
    } catch (error) {
      this.handleUniqueViolation(error, currentName);
    }
    return this.getOrThrow(id);
  }

  async remove(id: string): Promise<void> {
    const role = await this.getOrThrow(id);
    this.assertMutable(role, 'delete');

    // Capture affected users BEFORE the delete (user_roles cascade-removes the
    // link rows afterwards), then invalidate AFTER the delete so a concurrent
    // re-cache reflects the removed role instead of re-introducing stale rules.
    const userIds = await this.permissionsService.findUserIdsWithRole(id);
    await this.roleRepository.delete(id);
    await this.permissionsService.invalidateUsers(userIds);
  }

  async setPermissions(id: string, permissionIds: string[]): Promise<Role> {
    const role = await this.getOrThrow(id);
    this.assertMutable(role, 'modify permissions of');

    const distinctIds = [...new Set(permissionIds)];

    await this.dataSource.transaction(async (manager) => {
      if (distinctIds.length > 0) {
        // Reject unknown ids before wiping the existing set: a typo'd id
        // must never silently succeed and grant nothing.
        const existing = await manager.find(Permission, {
          where: { id: In(distinctIds) },
          select: { id: true },
        });
        if (existing.length !== distinctIds.length) {
          const found = new Set(existing.map((permission) => permission.id));
          const missing = distinctIds.filter(
            (permissionId) => !found.has(permissionId),
          );
          throw new BadRequestException(
            `Unknown permission id(s): ${missing.join(', ')}`,
          );
        }
      }

      await manager.delete(RolePermission, { roleId: role.id });
      if (distinctIds.length > 0) {
        await manager.save(
          RolePermission,
          distinctIds.map((permissionId) =>
            manager.create(RolePermission, { roleId: role.id, permissionId }),
          ),
        );
      }
    });

    const userIds = await this.permissionsService.findUserIdsWithRole(role.id);
    await this.permissionsService.invalidateUsers(userIds);
    return this.getOrThrow(id);
  }

  private async getOrThrow(id: string): Promise<Role> {
    const role = await this.findById(id);
    if (!role) {
      throw new NotFoundException('Role not found');
    }
    return role;
  }

  private assertMutable(role: Role, action: string): void {
    if (role.isSystem) {
      throw new ForbiddenException(
        `System role "${role.name}" cannot be ${action}`,
      );
    }
  }

  private handleUniqueViolation(error: unknown, key: string): never {
    if (isUniqueViolation(error)) {
      throw new ConflictException(`Role "${key}" already exists`);
    }
    throw error;
  }
}
