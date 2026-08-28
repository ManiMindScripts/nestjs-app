import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test', 'staging')
    .default('development'),

  PORT: Joi.number().port().default(3000),

  API_PREFIX: Joi.string().default('api'),

  CORS_ORIGIN: Joi.string().min(1).required(),

  FRONTEND_URL: Joi.string().uri().default('http://localhost:5173'),

  DB_HOST: Joi.string().min(1).required(),
  DB_PORT: Joi.number().port().default(5432),
  DB_USERNAME: Joi.string().min(1).required(),
  DB_PASSWORD: Joi.string().min(1).required(),
  DB_NAME: Joi.string().min(1).required(),
  DB_SYNCHRONIZE: Joi.boolean().default(false),
  DB_LOGGING: Joi.boolean().default(true),

  ADMIN_EMAIL: Joi.string().email().min(1).required(),
  ADMIN_PASSWORD: Joi.string().min(8).required(),

  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_EXPIRES_IN: Joi.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('7d'),
  JWT_COOKIE_NAME: Joi.string().min(1).default('refresh_token'),
  JWT_COOKIE_PATH: Joi.string().allow('').default(''),
  JWT_COOKIE_SECURE: Joi.boolean().optional(),
  JWT_COOKIE_SAME_SITE: Joi.string()
    .valid('lax', 'strict', 'none')
    .default('lax'),
  PASSWORD_RESET_TOKEN_TTL: Joi.string().default('30m'),

  // Mail delivery. Production MUST use the smtp driver (fail-fast at boot);
  // console mode prints reset links to the log and is for local development.
  MAIL_DRIVER: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string().valid('smtp').required(),
    otherwise: Joi.string().valid('console', 'smtp').default('console'),
  }),
  MAIL_HOST: Joi.string().when('MAIL_DRIVER', {
    is: 'smtp',
    then: Joi.string().min(1).required(),
    otherwise: Joi.optional(),
  }),
  MAIL_PORT: Joi.number().port().default(587),
  MAIL_SECURE: Joi.boolean().default(false),
  MAIL_USER: Joi.string().allow('').optional(),
  MAIL_PASS: Joi.string().allow('').optional(),
  MAIL_FROM: Joi.string().when('MAIL_DRIVER', {
    is: 'smtp',
    then: Joi.string().min(3).required(),
    otherwise: Joi.optional(),
  }),

  // Optional alerting sink for permanently-failed background work
  // (e.g. exhausted mail-queue retries). Empty = alerting disabled.
  ALERT_SLACK_WEBHOOK_URL: Joi.string().uri().allow('').default(''),

  REDIS_HOST: Joi.string().default('localhost'),
  REDIS_PORT: Joi.number().port().default(6379),
  REDIS_PASSWORD: Joi.string().allow('').default(''),

  // In seconds; converted to milliseconds where the throttler consumes it.
  THROTTLE_TTL: Joi.number().integer().positive().default(60),
  THROTTLE_LIMIT: Joi.number().integer().positive().default(100),

  // Hop count ("1") or comma-separated proxy IPs/CIDRs. Deliberately rejects
  // permissive values like "true": a wrong trust setting lets clients forge
  // X-Forwarded-For and mint fresh rate-limit buckets.
  TRUST_PROXY: Joi.string()
    .regex(
      /^(?:\d+|[0-9a-fA-F.:]+(?:\/\d{1,3})?(?:\s*,\s*[0-9a-fA-F.:]+(?:\/\d{1,3})?)*)$/,
    )
    .message(
      'TRUST_PROXY must be a verified hop count (e.g. "1") or a comma-separated list of proxy IPs/CIDRs',
    )
    .optional(),

  // 0 disables the WS connect rate limit (see .env.example).
  WS_CONNECT_RATE_LIMIT: Joi.number().integer().min(0).default(20),

  LOG_LEVEL: Joi.string()
    .valid('error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly')
    .default('info'),

  SWAGGER_ENABLED: Joi.boolean().default(true),

  // Observability metrics + 5xx error-rate alerting.
  METRICS_ENABLED: Joi.boolean().default(true),
  METRICS_ERROR_RATE_THRESHOLD: Joi.number().min(0).max(1).default(0.1),
  METRICS_WINDOW_MS: Joi.number().integer().positive().default(300000),
  METRICS_MIN_SAMPLES: Joi.number().integer().positive().default(20),
  METRICS_ALERT_COOLDOWN_MS: Joi.number().integer().positive().default(300000),
});
