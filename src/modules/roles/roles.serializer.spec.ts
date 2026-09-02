import { Role } from './entities/role.entity';
import { serializeRole } from './roles.serializer';

describe('serializeRole', () => {
  const role = {
    id: 'role-1',
    name: 'editor',
    description: 'Editors',
    isSystem: false,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-02'),
    rolePermissions: [
      {
        permission: { action: 'read', subject: 'Role' },
      },
      {
        permission: { action: 'read', subject: 'User' },
      },
    ],
  } as unknown as Role;

  it('flattens and sorts role permissions by action:subject', () => {
    expect(serializeRole(role).permissions).toEqual([
      { action: 'read', subject: 'Role' },
      { action: 'read', subject: 'User' },
    ]);
  });

  it('drops rolePermissions without a loaded permission', () => {
    const withMissing = {
      ...role,
      rolePermissions: [
        { permission: { action: 'read', subject: 'Role' } },
        { permission: null },
      ],
    } as unknown as Role;

    expect(serializeRole(withMissing).permissions).toEqual([
      { action: 'read', subject: 'Role' },
    ]);
  });

  it('maps the public fields', () => {
    const serialized = serializeRole({
      ...role,
      rolePermissions: [],
    });
    expect(serialized).toEqual({
      id: 'role-1',
      name: 'editor',
      description: 'Editors',
      isSystem: false,
      permissions: [],
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
    });
  });
});
