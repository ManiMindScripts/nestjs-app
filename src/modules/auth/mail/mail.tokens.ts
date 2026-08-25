import type { Transporter } from 'nodemailer';

export const MAIL_TRANSPORTER = Symbol('MAIL_TRANSPORTER');
export const MAIL_QUEUE = Symbol('MAIL_QUEUE');

export type MailTransporter = Transporter | null;

export interface PasswordResetMailJob {
  kind: 'password-reset';
  email: string;
  /**
   * Raw reset token, needed to build the link the recipient will click.
   * Acceptable in the queue payload because the token TTL (30m) is far
   * shorter than the removeOnFail retention (24h): any retained failed
   * payload holds a dead credential after the first 30 minutes.
   */
  token: string;
}

export type MailJob = PasswordResetMailJob;

export const MAIL_QUEUE_NAME = 'mail';
