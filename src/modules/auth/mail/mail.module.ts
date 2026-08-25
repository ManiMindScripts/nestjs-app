import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { Queue } from 'bullmq';
import {
  MAIL_CONNECT_TIMEOUT_MS,
  MAIL_GREETING_TIMEOUT_MS,
  MAIL_SOCKET_TIMEOUT_MS,
  MailConfig,
} from '../../../config/mail.config';
import { buildMailConnection } from './mail.connections';
import { MailProcessor } from './mail.processor';
import { MailQueueStatus } from './mail-queue.status';
import { MailService } from './mail.service';
import {
  MailJob,
  MAIL_QUEUE,
  MAIL_QUEUE_NAME,
  MAIL_TRANSPORTER,
} from './mail.tokens';

const SMTP_POOL_MAX_CONNECTIONS = 3;
const MAIL_JOB_ATTEMPTS = 3;
const MAIL_BACKOFF_BASE_MS = 1_000;
// Failed jobs stay inspectable for a day; comfortably outlives the reset
// token TTL, after which any retained token in a payload is inert.
const REMOVE_ON_FAIL_AGE_SECONDS = 24 * 60 * 60;

@Module({
  providers: [
    MailQueueStatus,
    MailProcessor,
    MailService,
    {
      provide: MAIL_TRANSPORTER,
      inject: [ConfigService],
      useFactory: (
        configService: ConfigService,
      ): nodemailer.Transporter | null => {
        const mail = configService.getOrThrow<MailConfig>('mail');

        if (mail.driver !== 'smtp') {
          return null;
        }

        return nodemailer.createTransport({
          host: mail.host,
          port: mail.port,
          secure: mail.secure,
          auth: mail.user
            ? { user: mail.user, pass: mail.pass ?? '' }
            : undefined,
          // Bounded transport timeouts: an unresponsive relay must never pin
          // a queue worker slot indefinitely.
          connectionTimeout: MAIL_CONNECT_TIMEOUT_MS,
          greetingTimeout: MAIL_GREETING_TIMEOUT_MS,
          socketTimeout: MAIL_SOCKET_TIMEOUT_MS,
          pool: true,
          maxConnections: SMTP_POOL_MAX_CONNECTIONS,
        });
      },
    },
    {
      provide: MAIL_QUEUE,
      inject: [ConfigService],
      useFactory: (configService: ConfigService): Queue<MailJob> =>
        new Queue<MailJob>(MAIL_QUEUE_NAME, {
          connection: buildMailConnection(configService, 'producer'),
          defaultJobOptions: {
            attempts: MAIL_JOB_ATTEMPTS,
            backoff: { type: 'exponential', delay: MAIL_BACKOFF_BASE_MS },
            removeOnComplete: true,
            removeOnFail: { age: REMOVE_ON_FAIL_AGE_SECONDS },
          },
        }),
    },
  ],
  exports: [MailService, MailQueueStatus],
})
export class MailModule {}
