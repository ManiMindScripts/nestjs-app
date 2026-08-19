import { createMongoAbility, MongoAbility } from '@casl/ability';
import { PermissionAction } from '../constants/permissions.enum';
import type { PermissionRule } from '../constants/permissions.enum';
import type { PermissionSubjectValue } from '../constants/permission-subjects';

export type AppAbility = MongoAbility<
  [PermissionAction, PermissionSubjectValue]
>;

export function createAppAbility(rules: PermissionRule[]): AppAbility {
  return createMongoAbility<AppAbility>(
    rules.map((rule) => ({ action: rule.action, subject: rule.subject })),
  );
}
