import { PermissionAction } from '../constants/permissions.enum';
import { PermissionSubject } from '../constants/permission-subjects';
import { createAppAbility } from './app-ability';

describe('createAppAbility', () => {
  it('satisfies a rule that is present with the same action and subject', () => {
    const ability = createAppAbility([
      { action: PermissionAction.MANAGE, subject: PermissionSubject.ROLE },
    ]);

    expect(ability.can(PermissionAction.MANAGE, PermissionSubject.ROLE)).toBe(
      true,
    );
  });

  it('rejects a rule whose action differs', () => {
    const ability = createAppAbility([
      { action: PermissionAction.READ, subject: PermissionSubject.ROLE },
    ]);

    expect(ability.can(PermissionAction.MANAGE, PermissionSubject.ROLE)).toBe(
      false,
    );
  });

  it('rejects a rule whose subject differs', () => {
    const ability = createAppAbility([
      { action: PermissionAction.MANAGE, subject: PermissionSubject.ROLE },
    ]);

    expect(
      ability.can(PermissionAction.MANAGE, PermissionSubject.PERMISSION),
    ).toBe(false);
  });

  it('rejects anything against an empty rule set', () => {
    const ability = createAppAbility([]);

    expect(ability.can(PermissionAction.READ, PermissionSubject.USER)).toBe(
      false,
    );
  });
});
