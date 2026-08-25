import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import type { Queue } from 'bullmq';
import { AppConfig } from '../../../config/app.config';
import { MailConfig } from '../../../config/mail.config';
import type { MailTransporter, MailJob } from './mail.tokens';
import { MAIL_QUEUE, MAIL_TRANSPORTER } from './mail.tokens';

const RESET_URL_PATH = '/reset-password';

@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);

  constructor(
    private readonly configService: ConfigService,
    @Inject(MAIL_TRANSPORTER) private readonly transporter: MailTransporter,
    @Inject(MAIL_QUEUE) private readonly queue: Queue<MailJob>,
  ) {}

  /**
   * Boot-time SMTP verification. In production an unreachable relay is a
   * configuration error that must abort startup; in dev/test it only warns
   * so local runs (and e2e, which has no SMTP server) keep working.
   */
  async onModuleInit(): Promise<void> {
    const app = this.configService.getOrThrow<AppConfig>('app');

    if (!this.transporter) {
      return;
    }

    try {
      await this.transporter.verify();
      this.logger.log('SMTP connection verified');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (app.nodeEnv === 'production') {
        throw new Error(`SMTP verification failed at boot: ${message}`);
      }
      this.logger.warn(
        `SMTP verification failed (continuing in ${app.nodeEnv}): ${message}`,
      );
    }
  }

  /**
   * Enqueue-only by design: never throws into the auth flow. A failed enqueue
   * is logged loudly for ops but the request still resolves so the endpoint
   * keeps its uniform response and cannot leak which emails exist.
   */
  sendPasswordReset(email: string, resetToken: string): Promise<void> {
    const mail = this.configService.getOrThrow<MailConfig>('mail');
    const app = this.configService.getOrThrow<AppConfig>('app');

    if (mail.driver === 'console') {
      const resetUrl = `${app.frontendUrl}${RESET_URL_PATH}?token=${resetToken}`;
      this.logger.warn(
        `[DEV MAIL] Password reset link for ${email}: ${resetUrl}`,
      );
      return Promise.resolve();
    }

    // Deterministic id: re-enqueueing the same token within its TTL window
    // collapses into one job instead of sending duplicate emails. The token
    // itself is hashed so queue inspection tools never see live credentials.
    // Separator must avoid ':' - BullMQ forbids it in custom ids because ids
    // are embedded in Redis key names (Job.validateOptions).
    const jobId = `pwreset-${createHash('sha256').update(resetToken).digest('hex')}`;

    return this.queue
      .add(
        'password-reset',
        { kind: 'password-reset', email, token: resetToken },
        { jobId },
      )
      .then(() => undefined)
      .catch((error: unknown) => {
        this.logger.error(
          `Failed to enqueue password-reset email for ${email}: ${
            error instanceof Error ? error.message : String(error)
          }`,
          error instanceof Error ? error.stack : undefined,
        );
        // Swallow: anti-enumeration + "never break the request" contract.
      });
  }
}
