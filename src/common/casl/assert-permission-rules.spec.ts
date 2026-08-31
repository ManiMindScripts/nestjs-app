import { ForbiddenException } from '@nestjs/common';
import { PermissionAction } from '../constants/permissions.enum';
import { PermissionSubject } from '../constants/permission-subjects';
import { createAppAbility } from './app-ability';
import { assertPermissionRules } from './assert-permission-rules';

describe('assertPermissionRules', () => {
  it('passes when every required rule is satisfied', () => {
    const ability = createAppAbility([
      { action: PermissionAction.MANAGE, subject: PermissionSubject.ROLE },
      { action: PermissionAction.READ, subject: PermissionSubject.USER },
    ]);

    expect(() =>
      assertPermissionRules(ability, [
        { action: PermissionAction.MANAGE, subject: PermissionSubject.ROLE },
        { action: PermissionAction.READ, subject: PermissionSubject.USER },
      ]),
    ).not.toThrow();
  });

  it('does nothing for an empty requirement list', () => {
    const ability = createAppAbility([]);

    expect(() => assertPermissionRules(ability, [])).not.toThrow();
  });

  it('throws 403 when any one required rule is missing', () => {
    const ability = createAppAbility([
      { action: PermissionAction.READ, subject: PermissionSubject.USER },
    ]);

    expect(() =>
      assertPermissionRules(ability, [
        { action: PermissionAction.READ, subject: PermissionSubject.USER },
        { action: PermissionAction.READ, subject: PermissionSubject.ROLE },
      ]),
    ).toThrow(ForbiddenException);
  });

  it('treats manage as implying the individual CRUD actions', () => {
    const ability = createAppAbility([
      { action: PermissionAction.MANAGE, subject: PermissionSubject.ROLE },
    ]);

    expect(() =>
      assertPermissionRules(ability, [
        { action: PermissionAction.DELETE, subject: PermissionSubject.ROLE },
      ]),
    ).not.toThrow();
  });
});
