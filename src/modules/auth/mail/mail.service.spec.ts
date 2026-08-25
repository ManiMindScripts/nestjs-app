import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { MailService } from './mail.service';
import type { MailJob } from './mail.tokens';
import { MAIL_QUEUE, MAIL_TRANSPORTER } from './mail.tokens';

describe('MailService', () => {
  let queueAdd: jest.Mock;
  let errorSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  const buildService = async (
    config: Record<string, unknown>,
    transporter: unknown = null,
  ): Promise<MailService> => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        MailService,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: (key: string) => {
              if (!(key in config)) {
                throw new Error(`Missing config section ${key}`);
              }
              return config[key];
            },
          },
        },
        { provide: MAIL_TRANSPORTER, useValue: transporter },
        { provide: MAIL_QUEUE, useValue: { add: queueAdd } },
      ],
    }).compile();

    return moduleRef.get(MailService);
  };

  beforeEach(() => {
    queueAdd = jest.fn().mockResolvedValue(undefined);
    errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('sendPasswordReset', () => {
    it('logs the dev link in console mode and never touches the queue', async () => {
      const service = await buildService({
        mail: { driver: 'console' },
        app: { nodeEnv: 'development', frontendUrl: 'http://localhost:5173' },
      });

      await service.sendPasswordReset('user@example.com', 'raw-token');

      expect(queueAdd).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[DEV MAIL]'),
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('token=raw-token'),
      );
    });

    it('enqueues with a hashed deterministic jobId in smtp mode', async () => {
      const service = await buildService(
        {
          mail: { driver: 'smtp' },
          app: {
            nodeEnv: 'production',
            frontendUrl: 'https://app.example.com',
          },
        },
        { verify: jest.fn().mockResolvedValue(undefined) },
      );

      await service.sendPasswordReset('user@example.com', 'raw-token');
      await service.sendPasswordReset('user@example.com', 'raw-token');

      expect(queueAdd).toHaveBeenCalledTimes(2);
      const [name, payload, firstOptions] = queueAdd.mock.calls[0] as [
        string,
        MailJob,
        { jobId: string },
      ];
      expect(name).toBe('password-reset');
      expect(payload).toEqual<MailJob>({
        kind: 'password-reset',
        email: 'user@example.com',
        token: 'raw-token',
      });
      // Deterministic across both calls, never the raw token. '-' separator:
      // BullMQ rejects ':' in custom job ids (Redis-key embedding).
      const [, , secondOptions] = queueAdd.mock.calls[1] as [
        string,
        MailJob,
        { jobId: string },
      ];
      expect(firstOptions.jobId).toMatch(/^pwreset-[0-9a-f]{64}$/);
      expect(firstOptions.jobId).not.toContain(':');
      expect(firstOptions.jobId).toBe(secondOptions.jobId);
    });

    it('swallows enqueue failures after logging loudly', async () => {
      queueAdd.mockRejectedValue(new Error('Redis connect timeout'));
      const service = await buildService(
        {
          mail: { driver: 'smtp' },
          app: {
            nodeEnv: 'production',
            frontendUrl: 'https://app.example.com',
          },
        },
        { verify: jest.fn() },
      );

      await expect(
        service.sendPasswordReset('user@example.com', 'raw-token'),
      ).resolves.toBeUndefined();

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Redis connect timeout'),
        expect.anything(),
      );
    });
  });

  describe('onModuleInit', () => {
    it('passes silently in console mode (no transporter)', async () => {
      const service = await buildService({
        mail: { driver: 'console' },
        app: { nodeEnv: 'development', frontendUrl: 'http://localhost:5173' },
      });

      await expect(service.onModuleInit()).resolves.toBeUndefined();
    });

    it('throws at boot when SMTP verification fails in production', async () => {
      const service = await buildService(
        {
          mail: { driver: 'smtp' },
          app: {
            nodeEnv: 'production',
            frontendUrl: 'https://app.example.com',
          },
        },
        { verify: jest.fn().mockRejectedValue(new Error('auth failed')) },
      );

      await expect(service.onModuleInit()).rejects.toThrow(
        'SMTP verification failed at boot: auth failed',
      );
    });

    it('only warns when SMTP verification fails outside production', async () => {
      const service = await buildService(
        {
          mail: { driver: 'smtp' },
          app: { nodeEnv: 'development', frontendUrl: 'http://localhost:5173' },
        },
        { verify: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) },
      );

      await expect(service.onModuleInit()).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('ECONNREFUSED'),
      );
    });
  });
});
