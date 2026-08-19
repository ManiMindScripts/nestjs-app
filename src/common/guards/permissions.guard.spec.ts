import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { createAppAbility } from '../casl/app-ability';
import { PermissionAction } from '../constants/permissions.enum';
import { PermissionSubject } from '../constants/permission-subjects';
import { PermissionsGuard } from './permissions.guard';

describe('PermissionsGuard', () => {
  let guard: PermissionsGuard;
  const reflector = { getAllAndOverride: jest.fn() };
  const permissionsService = { getAbilityForUser: jest.fn() };
  let request: { user?: { id: string } };

  const context = {
    getHandler: () => ({}),
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;

  beforeEach(() => {
    reflector.getAllAndOverride.mockReset();
    permissionsService.getAbilityForUser.mockReset();
    request = { user: { id: 'user-1' } };
    guard = new PermissionsGuard(
      reflector as never,
      permissionsService as never,
    );
  });

  it('allows routes with no required permissions', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(permissionsService.getAbilityForUser).not.toHaveBeenCalled();
  });

  it('allows routes with an empty permission requirement', async () => {
    reflector.getAllAndOverride.mockReturnValue([]);

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('rejects unauthenticated requests with 401', async () => {
    reflector.getAllAndOverride.mockReturnValue([
      { action: PermissionAction.MANAGE, subject: PermissionSubject.ROLE },
    ]);
    request.user = undefined;

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('allows when the user holds every required permission', async () => {
    const rules = [
      { action: PermissionAction.MANAGE, subject: PermissionSubject.ROLE },
      {
        action: PermissionAction.MANAGE,
        subject: PermissionSubject.PERMISSION,
      },
    ];
    reflector.getAllAndOverride.mockReturnValue(rules);
    permissionsService.getAbilityForUser.mockResolvedValue(
      createAppAbility([
        { action: PermissionAction.MANAGE, subject: PermissionSubject.ROLE },
        {
          action: PermissionAction.MANAGE,
          subject: PermissionSubject.PERMISSION,
        },
      ]),
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(permissionsService.getAbilityForUser).toHaveBeenCalledWith('user-1');
  });

  it('rejects with 403 when one required permission is missing', async () => {
    const rules = [
      { action: PermissionAction.MANAGE, subject: PermissionSubject.ROLE },
      {
        action: PermissionAction.MANAGE,
        subject: PermissionSubject.PERMISSION,
      },
    ];
    reflector.getAllAndOverride.mockReturnValue(rules);
    permissionsService.getAbilityForUser.mockResolvedValue(
      createAppAbility([
        { action: PermissionAction.MANAGE, subject: PermissionSubject.ROLE },
      ]),
    );

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rejects with 403 when the user has no matching permission at all', async () => {
    const rules = [
      { action: PermissionAction.READ, subject: PermissionSubject.USER },
    ];
    reflector.getAllAndOverride.mockReturnValue(rules);
    permissionsService.getAbilityForUser.mockResolvedValue(
      createAppAbility([]),
    );

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
