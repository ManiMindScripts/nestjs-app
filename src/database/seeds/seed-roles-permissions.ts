import 'reflect-metadata';
import 'dotenv/config';
import * as argon2 from 'argon2';
import { DataSource } from 'typeorm';
import { PermissionAction } from '../../common/constants/permissions.enum';
import { UserStatus } from '../../common/constants/user-status.enum';
import { Permission } from '../../modules/permissions/entities/permission.entity';
import { RolePermission } from '../../modules/permissions/entities/role-permission.entity';
import { Role } from '../../modules/roles/entities/role.entity';
import { UserRole } from '../../modules/roles/entities/user-role.entity';
import { User } from '../../modules/users/entities/user.entity';
import dataSource from '../data-source';

interface SeedRole {
  name: string;
  description: string;
  isSystem: boolean;
  permissions: { action: PermissionAction; subject: string }[];
}

const SEED_ROLES: SeedRole[] = [
  {
    name: 'admin',
    description: 'Full system administration access',
    isSystem: true,
    permissions: [
      { action: PermissionAction.MANAGE, subject: 'User' },
      { action: PermissionAction.MANAGE, subject: 'Role' },
      { action: PermissionAction.MANAGE, subject: 'Permission' },
    ],
  },
  {
    name: 'user',
    description: 'Default registered user',
    isSystem: true,
    permissions: [
      { action: PermissionAction.READ, subject: 'User' },
      { action: PermissionAction.READ, subject: 'Role' },
    ],
  },
];

async function seedPermissions(
  dataSource: DataSource,
): Promise<Map<string, Permission>> {
  const permissionRepository = dataSource.getRepository(Permission);
  const permissionMap = new Map<string, Permission>();

  for (const role of SEED_ROLES) {
    for (const seedPermission of role.permissions) {
      const key = `${seedPermission.action}:${seedPermission.subject}`;
      if (permissionMap.has(key)) {
        continue;
      }

      let permission = await permissionRepository.findOneBy({
        action: seedPermission.action,
        subject: seedPermission.subject,
      });

      if (!permission) {
        permission = await permissionRepository.save(
          permissionRepository.create(seedPermission),
        );
        console.log(`+ permission ${key}`);
      }

      permissionMap.set(key, permission);
    }
  }

  return permissionMap;
}

async function seedRoles(
  dataSource: DataSource,
  permissionMap: Map<string, Permission>,
): Promise<void> {
  const roleRepository = dataSource.getRepository(Role);
  const rolePermissionRepository = dataSource.getRepository(RolePermission);

  for (const seedRole of SEED_ROLES) {
    let role = await roleRepository.findOneBy({ name: seedRole.name });

    if (!role) {
      role = await roleRepository.save(
        roleRepository.create({
          name: seedRole.name,
          description: seedRole.description,
          isSystem: seedRole.isSystem,
        }),
      );
      console.log(`+ role ${seedRole.name}`);
    }

    for (const seedPermission of seedRole.permissions) {
      const permission = permissionMap.get(
        `${seedPermission.action}:${seedPermission.subject}`,
      );

      if (!permission) {
        continue;
      }

      const existing = await rolePermissionRepository.findOneBy({
        roleId: role.id,
        permissionId: permission.id,
      });

      if (!existing) {
        await rolePermissionRepository.save(
          rolePermissionRepository.create({
            roleId: role.id,
            permissionId: permission.id,
          }),
        );
        console.log(
          `+ role_permission ${seedRole.name} -> ${seedPermission.action}:${seedPermission.subject}`,
        );
      }
    }
  }
}

async function seedBootstrapAdmin(dataSource: DataSource): Promise<void> {
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminEmail || !adminPassword) {
    console.warn('ADMIN_EMAIL/ADMIN_PASSWORD not set, skipping admin seed');
    return;
  }

  const userRepository = dataSource.getRepository(User);
  const roleRepository = dataSource.getRepository(Role);
  const userRoleRepository = dataSource.getRepository(UserRole);

  let admin = await userRepository.findOneBy({ email: adminEmail });

  if (!admin) {
    const passwordHash = await argon2.hash(adminPassword);
    admin = await userRepository.save(
      userRepository.create({
        email: adminEmail,
        passwordHash,
        status: UserStatus.ACTIVE,
      }),
    );
    console.log(`+ user ${adminEmail}`);
  }

  const adminRole = await roleRepository.findOneByOrFail({ name: 'admin' });
  const existing = await userRoleRepository.findOneBy({
    userId: admin.id,
    roleId: adminRole.id,
  });

  if (!existing) {
    await userRoleRepository.save(
      userRoleRepository.create({
        userId: admin.id,
        roleId: adminRole.id,
      }),
    );
    console.log(`+ user_role ${adminEmail} -> admin`);
  }
}

async function seed(): Promise<void> {
  await dataSource.initialize();

  try {
    const permissionMap = await seedPermissions(dataSource);
    await seedRoles(dataSource, permissionMap);
    await seedBootstrapAdmin(dataSource);
    console.log('Seeding complete.');
  } finally {
    await dataSource.destroy();
  }
}

seed().catch((error: unknown) => {
  console.error('Seeding failed:', error);
  process.exit(1);
});
