import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Queue, Worker } from 'bullmq';
import type { Transporter } from 'nodemailer';
import { AppConfig } from '../../../config/app.config';
import { MailConfig } from '../../../config/mail.config';
import { JwtConfig } from '../../../config/jwt.config';
import { AlertingService } from '../../../shared/alerting/alerting.service';
import { buildMailConnection } from './mail.connections';
import {
  MailJob,
  MAIL_QUEUE,
  MAIL_QUEUE_NAME,
  MAIL_TRANSPORTER,
} from './mail.tokens';
import { MailQueueStatus } from './mail-queue.status';
import { buildPasswordResetEmail } from './mail.templates';

const WORKER_CONCURRENCY = 1;

/**
 * Owns the BullMQ worker for the mail queue. The worker runs in-process
 * (monolith-appropriate); extracting it later means bootstrapping this same
 * class from a standalone entrypoint - the processor logic stays unchanged.
 *
 * Queued-but-unstarted jobs survive process death (they live in Redis), so
 * SIGTERM only needs to drain the currently-active send.
 */
@Injectable()
export class MailProcessor implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(MailProcessor.name);
  private worker: Worker<MailJob> | null = null;

  constructor(
    private readonly configService: ConfigService,
    @Inject(MAIL_TRANSPORTER) private readonly transporter: Transporter | null,
    @Inject(MAIL_QUEUE) private readonly queue: Queue<MailJob>,
    private readonly mailQueueStatus: MailQueueStatus,
    private readonly alertingService: AlertingService,
  ) {}

  onModuleInit(): void {
    const app = this.configService.getOrThrow<AppConfig>('app');
    // E2E/unit environments must not consume jobs from a shared local Redis
    // while a dev instance is also running; they override MailService anyway.
    if (app.nodeEnv === 'test') {
      return;
    }

    this.worker = new Worker<MailJob>(
      MAIL_QUEUE_NAME,
      (job) => this.process(job),
      {
        connection: buildMailConnection(this.configService, 'worker'),
        concurrency: WORKER_CONCURRENCY,
      },
    );

    this.worker.on('completed', (job) => {
      this.logger.log(`Delivered mail job ${job.id ?? job.name}`);
    });

    this.worker.on('failed', (job, error) => {
      this.handleFailure(job, error);
    });

    this.worker.on('error', (error) => {
      // Worker-level faults (Redis connection issues), not job failures.
      this.logger.error(
        `Mail worker error: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
  }

  async onApplicationShutdown(): Promise<void> {
    // Drain the active job first, THEN close the producer connection -
    // reversed order could orphan an in-flight send's bookkeeping. BullMQ
    // owns both connections (plain ConnectionOptions were passed in), so
    // close() releases them fully and the process can exit.
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    await this.queue.close();
  }

  async process(job: Job<MailJob>): Promise<void> {
    switch (job.data.kind) {
      case 'password-reset':
        await this.sendPasswordReset(job.data);
        return;
      default:
        throw new Error(`Unknown mail job kind: ${String(job.data.kind)}`);
    }
  }

  private async sendPasswordReset(
    data: Extract<MailJob, { kind: 'password-reset' }>,
  ): Promise<void> {
    if (!this.transporter) {
      throw new Error('SMTP transporter unavailable but smtp job dequeued');
    }

    const mail = this.configService.getOrThrow<MailConfig>('mail');
    const jwt = this.configService.getOrThrow<JwtConfig>('jwt');
    const app = this.configService.getOrThrow<AppConfig>('app');
    const content = buildPasswordResetEmail({
      frontendUrl: app.frontendUrl,
      resetToken: data.token,
      resetTokenTtl: jwt.resetTokenTtl,
    });

    await this.transporter.sendMail({
      from: mail.from,
      to: data.email,
      subject: content.subject,
      text: content.text,
      html: content.html,
    });
  }

  private handleFailure(job: Job<MailJob> | undefined, error: Error): void {
    const reason = error.message || String(error);
    const recipient =
      job?.data && 'email' in job.data ? job.data.email : 'unknown';

    if (!this.isFinalFailure(job)) {
      this.logger.warn(
        `Mail job attempt failed (will retry): ${reason}; to=${recipient}`,
      );
      return;
    }

    // Distinct marker so "exhausted retries" is greppably different from the
    // per-attempt warnings above. Never log the token itself.
    this.logger.error(
      `[MAIL PERMANENTLY FAILED] Job ${job?.id ?? 'unknown'} exhausted all retries: ${reason}; to=${recipient}`,
    );
    this.mailQueueStatus.markPermanentFailure(reason);
    this.alertingService.notify(
      `:rotating_light: Password-reset email permanently failed after all retries (${reason}). Recipient: ${recipient}. Check /health and SMTP config.`,
    );
  }

  private isFinalFailure(job: Job<MailJob> | undefined): boolean {
    if (!job) {
      return true;
    }
    const maxAttempts = job.opts.attempts ?? 1;
    return job.attemptsMade >= maxAttempts;
  }
}
