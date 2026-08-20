import { ForbiddenException } from '@nestjs/common';
import type { PermissionRule } from '../constants/permissions.enum';
import type { AppAbility } from './app-ability';

export function assertPermissionRules(
  ability: AppAbility,
  rules: PermissionRule[],
): void {
  if (
    rules.length > 0 &&
    rules.some((rule) => !ability.can(rule.action, rule.subject))
  ) {
    throw new ForbiddenException('Insufficient permissions');
  }
}
