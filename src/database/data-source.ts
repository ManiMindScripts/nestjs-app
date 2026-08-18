import 'reflect-metadata';
import 'dotenv/config';
import { DataSource } from 'typeorm';
import { RefreshToken } from '../modules/auth/entities/refresh-token.entity';
import { RolePermission } from '../modules/permissions/entities/role-permission.entity';
import { Permission } from '../modules/permissions/entities/permission.entity';
import { Role } from '../modules/roles/entities/role.entity';
import { UserRole } from '../modules/roles/entities/user-role.entity';
import { User } from '../modules/users/entities/user.entity';
import { SnakeCaseNamingStrategy } from './naming-strategy';

export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: parseInt(process.env.DB_PORT ?? '5432', 10),
  username: process.env.DB_USERNAME ?? 'postgres',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME ?? 'my_app',
  entities: [User, Role, Permission, UserRole, RolePermission, RefreshToken],
  migrations: ['src/database/migrations/*.{ts,js}'],
  namingStrategy: new SnakeCaseNamingStrategy(),
  synchronize: false,
  logging: (process.env.DB_LOGGING ?? 'true').toLowerCase() === 'true',
});
