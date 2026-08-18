import { registerAs } from '@nestjs/config';

export interface DatabaseConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  synchronize: boolean;
  logging: boolean;
}

export const databaseConfig = registerAs('database', (): DatabaseConfig => {
  const env = process.env;

  return {
    host: env.DB_HOST ?? 'localhost',
    port: parseInt(env.DB_PORT ?? '5432', 10),
    username: env.DB_USERNAME ?? 'postgres',
    password: env.DB_PASSWORD ?? 'postgres',
    database: env.DB_NAME ?? 'my_app',
    synchronize: (env.DB_SYNCHRONIZE ?? 'false').toLowerCase() === 'true',
    logging: (env.DB_LOGGING ?? 'true').toLowerCase() === 'true',
  };
});
