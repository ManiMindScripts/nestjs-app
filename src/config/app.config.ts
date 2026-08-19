import { registerAs } from '@nestjs/config';

export interface AppConfig {
  nodeEnv: 'development' | 'production' | 'test' | 'staging';
  port: number;
  apiPrefix: string;
  corsOrigin: string;
  frontendUrl: string;
  logLevel: string;
  swaggerEnabled: boolean;
}

export const appConfig = registerAs('app', (): AppConfig => {
  const env = process.env;
  const nodeEnv = env.NODE_ENV as AppConfig['nodeEnv'];

  const swaggerOverride = env.SWAGGER_ENABLED;
  const swaggerEnabled = swaggerOverride
    ? swaggerOverride.toLowerCase() === 'true'
    : nodeEnv !== 'production';

  return {
    nodeEnv,
    port: parseInt(env.PORT ?? '3000', 10),
    apiPrefix: env.API_PREFIX ?? 'api',
    corsOrigin: env.CORS_ORIGIN ?? 'http://localhost:5173',
    frontendUrl: env.FRONTEND_URL ?? 'http://localhost:5173',
    logLevel: env.LOG_LEVEL ?? 'info',
    swaggerEnabled,
  };
});
