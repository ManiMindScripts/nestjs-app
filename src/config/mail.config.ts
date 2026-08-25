import { registerAs } from '@nestjs/config';

export type MailDriver = 'console' | 'smtp';

export interface MailConfig {
  driver: MailDriver;
  host?: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from?: string;
}

// Transport-level timeouts: a misconfigured relay must never hold a request
// or a queue worker hostage.
export const MAIL_CONNECT_TIMEOUT_MS = 10_000;
export const MAIL_GREETING_TIMEOUT_MS = 10_000;
export const MAIL_SOCKET_TIMEOUT_MS = 15_000;

export const mailConfig = registerAs('mail', (): MailConfig => {
  const env = process.env;

  return {
    driver: (env.MAIL_DRIVER as MailDriver) ?? 'console',
    host: env.MAIL_HOST,
    port: parseInt(env.MAIL_PORT ?? '587', 10),
    secure: (env.MAIL_SECURE ?? 'false').toLowerCase() === 'true',
    user: env.MAIL_USER,
    pass: env.MAIL_PASS,
    from: env.MAIL_FROM,
  };
});
