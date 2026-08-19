export const PermissionSubject = {
  USER: 'User',
  ROLE: 'Role',
  PERMISSION: 'Permission',
} as const;

export type PermissionSubjectValue =
  (typeof PermissionSubject)[keyof typeof PermissionSubject];

export const PERMISSION_SUBJECT_VALUES = Object.values(PermissionSubject);
