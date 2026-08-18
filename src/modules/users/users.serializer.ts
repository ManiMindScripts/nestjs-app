import { User } from './entities/user.entity';

export interface SafeUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  status: string;
  emailVerifiedAt: Date | null;
  createdAt: Date;
}

export function serializeUser(user: User): SafeUser {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    status: user.status,
    emailVerifiedAt: user.emailVerifiedAt,
    createdAt: user.createdAt,
  };
}
