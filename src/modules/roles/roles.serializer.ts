import { Role } from './entities/role.entity';

export interface SafeRolePermission {
  action: string;
  subject: string;
}

export interface SafeRole {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: SafeRolePermission[];
  createdAt: Date;
  updatedAt: Date;
}

export function serializeRole(role: Role): SafeRole {
  const permissions: SafeRolePermission[] = (role.rolePermissions ?? [])
    .filter((rolePermission) => rolePermission.permission)
    .map((rolePermission) => ({
      action: rolePermission.permission.action,
      subject: rolePermission.permission.subject,
    }))
    .sort((a, b) =>
      `${a.action}:${a.subject}`.localeCompare(`${b.action}:${b.subject}`),
    );

  return {
    id: role.id,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    permissions,
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
  };
}
