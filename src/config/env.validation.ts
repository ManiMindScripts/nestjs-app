import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test', 'staging')
    .default('development'),

  PORT: Joi.number().port().default(3000),

  API_PREFIX: Joi.string().default('api'),

  CORS_ORIGIN: Joi.string().min(1).required(),

  DB_HOST: Joi.string().min(1).required(),
  DB_PORT: Joi.number().port().default(5432),
  DB_USERNAME: Joi.string().min(1).required(),
  DB_PASSWORD: Joi.string().min(1).required(),
  DB_NAME: Joi.string().min(1).required(),
  DB_SYNCHRONIZE: Joi.boolean().default(false),
  DB_LOGGING: Joi.boolean().default(true),

  ADMIN_EMAIL: Joi.string().email().min(1).required(),
  ADMIN_PASSWORD: Joi.string().min(8).required(),

  JWT_ACCESS_SECRET: Joi.string().min(1).required(),
  JWT_ACCESS_EXPIRES_IN: Joi.string().default('15m'),
  JWT_REFRESH_SECRET: Joi.string().min(1).required(),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('7d'),

  REDIS_HOST: Joi.string().default('localhost'),
  REDIS_PORT: Joi.number().port().default(6379),
  REDIS_PASSWORD: Joi.string().allow('').default(''),

  THROTTLE_TTL: Joi.number().integer().positive().default(60),
  THROTTLE_LIMIT: Joi.number().integer().positive().default(100),

  BULL_PREFIX: Joi.string().default('my_app_queue'),

  LOG_LEVEL: Joi.string()
    .valid('error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly')
    .default('info'),

  SWAGGER_ENABLED: Joi.boolean().default(true),
});
