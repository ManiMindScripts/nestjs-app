import { registerAs } from '@nestjs/config';
import { parseDurationToMs } from '../common/utils/duration';

export type DurationLike = `${number}${'s' | 'm' | 'h' | 'd' | 'w'}`;

export interface JwtConfig {
  accessSecret: string;
  accessExpiresIn: string;
  accessExpiresInMs: number;
  refreshExpiresIn: string;
  refreshExpiresInMs: number;
  cookieName: string;
  cookiePath: string;
  cookieSecure: boolean;
  cookieSameSite: 'lax' | 'strict' | 'none';
  resetTokenTtl: string;
  resetTokenTtlMs: number;
}

export const jwtConfig = registerAs('jwt', (): JwtConfig => {
  const env = process.env;
  const apiPrefix = env.API_PREFIX ?? 'api';
  const nodeEnv = env.NODE_ENV ?? 'development';

  const accessExpiresIn = env.JWT_ACCESS_EXPIRES_IN ?? '15m';
  const refreshExpiresIn = env.JWT_REFRESH_EXPIRES_IN ?? '7d';
  const resetTokenTtl = env.PASSWORD_RESET_TOKEN_TTL ?? '30m';

  const accessSecret = env.JWT_ACCESS_SECRET;
  if (!accessSecret) {
    throw new Error('JWT_ACCESS_SECRET is not configured');
  }

  const cookieSecure =
    env.JWT_COOKIE_SECURE === undefined
      ? nodeEnv === 'production'
      : env.JWT_COOKIE_SECURE.toLowerCase() === 'true';

  return {
    accessSecret,
    accessExpiresIn,
    accessExpiresInMs: parseDurationToMs(accessExpiresIn),
    refreshExpiresIn,
    refreshExpiresInMs: parseDurationToMs(refreshExpiresIn),
    cookieName: env.JWT_COOKIE_NAME ?? 'refresh_token',
    cookiePath: env.JWT_COOKIE_PATH || `/${apiPrefix}/auth`,
    cookieSecure,
    cookieSameSite: (env.JWT_COOKIE_SAME_SITE ??
      'lax') as JwtConfig['cookieSameSite'],
    resetTokenTtl,
    resetTokenTtlMs: parseDurationToMs(resetTokenTtl),
  };
});
