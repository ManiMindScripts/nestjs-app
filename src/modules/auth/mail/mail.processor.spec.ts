import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { MailProcessor } from './mail.processor';
import { MailQueueStatus } from './mail-queue.status';
import type { MailJob } from './mail.tokens';

describe('MailProcessor', () => {
  const buildProcessor = (
    transporter: { sendMail: jest.Mock } | null,
    overrides: Partial<Record<'app' | 'mail' | 'jwt', unknown>> = {},
  ): {
    processor: MailProcessor;
    alerting: { notify: jest.Mock };
    status: MailQueueStatus;
  } => {
    const config = {
      app: { nodeEnv: 'development', frontendUrl: 'http://localhost:5173' },
      mail: { driver: 'smtp', from: '"My App" <no-reply@example.com>' },
      jwt: { resetTokenTtl: '30m' },
      ...overrides,
    };
    const status = new MailQueueStatus();
    const processor = new MailProcessor(
      {
        getOrThrow: (key: string): unknown => config[key],
      } as never,
      transporter as never,
      { close: jest.fn().mockResolvedValue(undefined) } as never,
      status,
      { notify: jest.fn() } as never,
    );
    return {
      processor,
      alerting: (
        processor as unknown as { alertingService: { notify: jest.Mock } }
      ).alertingService,
      status,
    };
  };

  const jobOf = (data: MailJob, attemptsMade: number): Job<MailJob> =>
    ({
      id: 'pwreset-abc',
      data,
      attemptsMade,
      opts: { attempts: 3 },
    }) as unknown as Job<MailJob>;

  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('failure classification', () => {
    it('treats attempts below the cap as retryable: warn only', () => {
      const { processor, alerting, status } = buildProcessor(null);

      (
        processor as unknown as {
          handleFailure(job: Job<MailJob> | undefined, error: Error): void;
        }
      ).handleFailure(
        jobOf({ kind: 'password-reset', email: 'u@e.com', token: 't' }, 1),
        new Error('relay 451'),
      );

      expect(alerting.notify).not.toHaveBeenCalled();
      expect(status.failure).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('will retry'),
      );
    });

    it('marks exhaustion permanently and alerts once the cap is hit', () => {
      const { processor, alerting, status } = buildProcessor(null);

      (
        processor as unknown as {
          handleFailure(job: Job<MailJob> | undefined, error: Error): void;
        }
      ).handleFailure(
        jobOf({ kind: 'password-reset', email: 'u@e.com', token: 't' }, 3),
        new Error('relay 550'),
      );

      expect(errorSpy).toHaveBeenCalledTimes(1);
      const [loggedLine] = errorSpy.mock.calls[0] as [string];
      expect(loggedLine).toContain('[MAIL PERMANENTLY FAILED]');
      expect(loggedLine).toContain('to=u@e.com');
      expect(alerting.notify).toHaveBeenCalledTimes(1);
      expect(alerting.notify).toHaveBeenCalledWith(
        expect.stringContaining('permanently failed'),
      );
      expect(status.failure?.reason).toBe('relay 550');
      expect(status.failure?.at).toEqual(expect.any(String));
    });

    it('never logs the reset token itself', () => {
      const { processor } = buildProcessor(null);

      (
        processor as unknown as {
          handleFailure(job: Job<MailJob> | undefined, error: Error): void;
        }
      ).handleFailure(
        jobOf(
          { kind: 'password-reset', email: 'u@e.com', token: 'SECRET-TOKEN' },
          3,
        ),
        new Error('boom'),
      );

      const logged = JSON.stringify(errorSpy.mock.calls);
      expect(logged).not.toContain('SECRET-TOKEN');
    });
  });

  describe('dispatch', () => {
    it('renders and sends password-reset jobs through SMTP', async () => {
      const sendMail = jest.fn().mockResolvedValue(undefined);
      const { processor } = buildProcessor({ sendMail });

      await (
        processor as unknown as {
          process(job: Job<MailJob>): Promise<void>;
        }
      ).process(
        jobOf(
          { kind: 'password-reset', email: 'user@example.com', token: 'tok' },
          0,
        ),
      );

      expect(sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'user@example.com',
          from: '"My App" <no-reply@example.com>',
        }),
      );
      const [message] = sendMail.mock.calls[0] as [
        { to: string; from: string; html: string; text: string },
      ];
      expect(message.html).toContain('reset-password?token=tok');
      expect(message.text).toContain('30 minutes');
    });

    it('rejects unknown job kinds instead of silently dropping them', async () => {
      const sendMail = jest.fn();
      const { processor } = buildProcessor({ sendMail });

      await expect(
        (
          processor as unknown as {
            process(job: Job<MailJob>): Promise<void>;
          }
        ).process({ data: { kind: 'newsletter' } } as unknown as Job<MailJob>),
      ).rejects.toThrow('Unknown mail job kind');

      expect(sendMail).not.toHaveBeenCalled();
    });
  });

  describe('lifecycle', () => {
    it('starts no worker under NODE_ENV=test so e2e never consumes jobs', () => {
      const { processor } = buildProcessor(null, {
        app: { nodeEnv: 'test', frontendUrl: 'http://localhost:5173' },
      });

      processor.onModuleInit();

      expect(processor['worker']).toBeNull();
    });

    it('closes worker then queue on shutdown', async () => {
      const { processor } = buildProcessor(null);
      const workerClose = jest.fn().mockResolvedValue(undefined);
      // Stub instead of calling onModuleInit(): a real worker would open a
      // live Redis connection inside this unit test.
      processor['worker'] = {
        close: workerClose,
      } as unknown as import('bullmq').Worker<MailJob>;
      const queueClose = (
        processor as unknown as { queue: { close: jest.Mock } }
      ).queue.close;

      await processor.onApplicationShutdown();

      expect(workerClose).toHaveBeenCalled();
      expect(queueClose).toHaveBeenCalled();
    });
  });
});
