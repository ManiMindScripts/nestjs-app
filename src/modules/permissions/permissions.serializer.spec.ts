import { Permission } from './entities/permission.entity';
import { serializePermission } from './permissions.serializer';

describe('serializePermission', () => {
  const base = {
    id: 'perm-1',
    action: 'read',
    subject: 'User',
    description: 'Read users',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-02'),
  } as Permission;

  it('maps the public fields', () => {
    expect(serializePermission(base)).toEqual({
      id: 'perm-1',
      action: 'read',
      subject: 'User',
      description: 'Read users',
      createdAt: base.createdAt,
      updatedAt: base.updatedAt,
    });
  });

  it('preserves a null description', () => {
    expect(
      serializePermission({ ...base, description: null }).description,
    ).toBeNull();
  });
});
