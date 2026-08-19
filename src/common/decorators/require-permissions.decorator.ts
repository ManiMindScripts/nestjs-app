import { SetMetadata } from '@nestjs/common';
import type { PermissionRule } from '../constants/permissions.enum';

export const REQUIRED_PERMISSIONS_KEY = 'required_permissions';

export const RequirePermissions = (
  ...rules: PermissionRule[]
): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_PERMISSIONS_KEY, rules);
