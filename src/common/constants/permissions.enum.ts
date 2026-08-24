import { PermissionSubjectValue } from './permission-subjects';

export enum PermissionAction {
  MANAGE = 'manage',
  CREATE = 'create',
  READ = 'read',
  UPDATE = 'update',
  DELETE = 'delete',
}

export interface PermissionRule {
  action: PermissionAction;
  subject: PermissionSubjectValue;
}

export function permissionKey({
  action,
  subject,
}: {
  action: string;
  subject: string;
}): string {
  return `${action}:${subject}`;
}
