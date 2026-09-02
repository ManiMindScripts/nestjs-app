import { User } from './entities/user.entity';
import { serializeUser } from './users.serializer';

describe('serializeUser', () => {
  const user = {
    id: 'user-1',
    email: 'a@example.com',
    firstName: 'Alice',
    lastName: 'Smith',
    status: 'active',
    emailVerifiedAt: new Date('2026-01-01'),
    createdAt: new Date('2026-01-02'),
    passwordHash: 'should-never-leak',
    userRoles: [
      { role: { id: 'role-1', name: 'admin' } },
      { role: { id: 'role-2', name: 'user' } },
    ],
  } as unknown as User;

  it('maps the public fields', () => {
    expect(serializeUser(user)).toEqual({
      id: 'user-1',
      email: 'a@example.com',
      firstName: 'Alice',
      lastName: 'Smith',
      status: 'active',
      emailVerifiedAt: user.emailVerifiedAt,
      createdAt: user.createdAt,
      roles: [
        { id: 'role-1', name: 'admin' },
        { id: 'role-2', name: 'user' },
      ],
    });
  });

  it('never exposes the password hash', () => {
    const serialized = serializeUser(user) as unknown as Record<
      string,
      unknown
    >;
    expect(serialized.passwordHash).toBeUndefined();
    expect(JSON.stringify(serialized)).not.toContain('should-never-leak');
  });

  it('omits the roles key when the user has no roles loaded', () => {
    const serialized = serializeUser({
      ...user,
      userRoles: [],
    }) as { roles?: unknown };

    expect(serialized.roles).toBeUndefined();
  });
});
