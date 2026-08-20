export const PermissionSubject = {
  USER: 'User',
  ROLE: 'Role',
  PERMISSION: 'Permission',
  NOTIFICATION: 'Notification',
} as const;

export type PermissionSubjectValue =
  (typeof PermissionSubject)[keyof typeof PermissionSubject];

export const PERMISSION_SUBJECT_VALUES = Object.values(PermissionSubject);
