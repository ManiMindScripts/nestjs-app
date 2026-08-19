import { Permission } from './entities/permission.entity';

export interface SafePermission {
  id: string;
  action: string;
  subject: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export function serializePermission(permission: Permission): SafePermission {
  return {
    id: permission.id,
    action: permission.action,
    subject: permission.subject,
    description: permission.description,
    createdAt: permission.createdAt,
    updatedAt: permission.updatedAt,
  };
}
