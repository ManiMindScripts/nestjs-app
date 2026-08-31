import { envValidationSchema } from './env.validation';

const baseValid = {
  NODE_ENV: 'test',
  CORS_ORIGIN: 'http://localhost:5173',
  DB_HOST: 'localhost',
  DB_USERNAME: 'postgres',
  DB_PASSWORD: 'postgres',
  DB_NAME: 'my_app',
  ADMIN_EMAIL: 'admin@example.com',
  ADMIN_PASSWORD: 'Admin123',
  JWT_ACCESS_SECRET: 'a-very-long-secret-that-is-at-least-thirty-two-chars',
};

describe('envValidationSchema', () => {
  it('accepts a valid environment', () => {
    const { error } = envValidationSchema.validate(baseValid, {
      allowUnknown: true,
    });
    expect(error).toBeUndefined();
  });

  it('rejects a missing required CORS_ORIGIN', () => {
    const { error } = envValidationSchema.validate(
      { ...baseValid, CORS_ORIGIN: undefined },
      { allowUnknown: true },
    );
    expect(error?.message).toContain('CORS_ORIGIN');
  });

  it('rejects a short JWT access secret', () => {
    const { error } = envValidationSchema.validate(
      { ...baseValid, JWT_ACCESS_SECRET: 'short' },
      { allowUnknown: true },
    );
    expect(error?.message).toContain('JWT_ACCESS_SECRET');
  });

  it('rejects a permissive TRUST_PROXY value', () => {
    const { error } = envValidationSchema.validate(
      { ...baseValid, TRUST_PROXY: 'true' },
      { allowUnknown: true },
    );
    expect(error?.message).toContain('TRUST_PROXY');
  });

  it('rejects mail driver that is not smtp in production', () => {
    const { error } = envValidationSchema.validate(
      { ...baseValid, NODE_ENV: 'production', MAIL_DRIVER: 'console' },
      { allowUnknown: true },
    );
    expect(error).toBeDefined();
  });

  it('defaults optional fields', () => {
    const { error, value } = envValidationSchema.validate(baseValid, {
      allowUnknown: true,
    }) as { error?: unknown; value: Record<string, unknown> };
    expect(error).toBeUndefined();
    expect(value.THROTTLE_TTL).toBe(60);
    expect(value.REDIS_HOST).toBe('localhost');
  });
});
