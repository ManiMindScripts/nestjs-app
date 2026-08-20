import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRED_PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';
import { assertPermissionRules } from '../casl/assert-permission-rules';
import type { PermissionRule } from '../constants/permissions.enum';
import { PermissionsService } from '../../modules/permissions/permissions.service';
import type { User } from '../../modules/users/entities/user.entity';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissionsService: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const rules = this.reflector.getAllAndOverride<PermissionRule[]>(
      REQUIRED_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!rules || rules.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{ user?: User }>();
    const user = request.user;
    if (!user) {
      throw new UnauthorizedException();
    }

    // AND semantics: EVERY required rule must pass. A route decorated with
    // @RequirePermissions(manage:Role, manage:Permission) fails 403 if either
    // is missing. Combine rules deliberately — never expect OR (any-of)
    // behavior from this guard.
    const ability = await this.permissionsService.getAbilityForUser(user.id);
    assertPermissionRules(ability, rules);

    return true;
  }
}
