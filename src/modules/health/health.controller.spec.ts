import { HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { RealtimeAdapterStatus } from '../realtime/realtime-adapter.status';
import { MailQueueStatus } from '../auth/mail/mail-queue.status';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  const dataSource = { query: jest.fn() };
  const redis = { ping: jest.fn() };
  let adapterStatus: RealtimeAdapterStatus;
  let mailQueueStatus: MailQueueStatus;
  let controller: HealthController;
  let response: { status: jest.Mock };

  beforeEach(() => {
    dataSource.query.mockReset();
    redis.ping.mockReset();
    adapterStatus = new RealtimeAdapterStatus();
    mailQueueStatus = new MailQueueStatus();
    controller = new HealthController(
      dataSource as never,
      redis as never,
      adapterStatus,
      mailQueueStatus,
    );
    response = { status: jest.fn() };
  });

  it('reports ok when every dependency is healthy', async () => {
    dataSource.query.mockResolvedValue([{ '?column?': 1 }]);
    redis.ping.mockResolvedValue('PONG');
    adapterStatus.markAttached();

    const body = await controller.check(response as unknown as Response);

    expect(body.status).toBe('ok');
    expect(body.db.status).toBe('up');
    expect(body.redis.status).toBe('up');
    expect(body.redisAdapter).toEqual({ status: 'ok' });
    expect(body.mail).toEqual({ lastFailureReason: null, lastFailureAt: null });
    expect(response.status).not.toHaveBeenCalled();
  });

  it('surfaces mail permanent failures without flipping overall status', async () => {
    dataSource.query.mockResolvedValue([{ '?column?': 1 }]);
    redis.ping.mockResolvedValue('PONG');
    adapterStatus.markAttached();
    mailQueueStatus.markPermanentFailure('SMTP relay refused connection');

    const body = await controller.check(response as unknown as Response);

    expect(body.status).toBe('ok');
    expect(body.mail.lastFailureReason).toBe('SMTP relay refused connection');
    expect(body.mail.lastFailureAt).toEqual(expect.any(String));
    expect(response.status).not.toHaveBeenCalled();
  });

  it('returns 503 when the redis IO adapter is degraded', async () => {
    dataSource.query.mockResolvedValue([{ '?column?': 1 }]);
    redis.ping.mockResolvedValue('PONG');
    adapterStatus.markDegraded('Redis unreachable');

    const body = await controller.check(response as unknown as Response);

    expect(body.status).toBe('degraded');
    expect(body.redisAdapter).toEqual(
      expect.objectContaining({
        status: 'degraded',
        reason: 'Redis unreachable',
      }),
    );
    expect(body.redisAdapter).toHaveProperty('since');
    expect(response.status).toHaveBeenCalledWith(
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  });

  it('returns 503 when the redis IO adapter is pending attachment', async () => {
    dataSource.query.mockResolvedValue([{ '?column?': 1 }]);
    redis.ping.mockResolvedValue('PONG');

    const body = await controller.check(response as unknown as Response);

    expect(body.status).toBe('degraded');
    expect(body.redisAdapter).toEqual({
      status: 'pending',
      reason: null,
      since: null,
    });
    expect(response.status).toHaveBeenCalledWith(
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  });

  it('returns 503 when redis is down', async () => {
    dataSource.query.mockResolvedValue([{ '?column?': 1 }]);
    redis.ping.mockRejectedValue(new Error('ECONNREFUSED'));

    const body = await controller.check(response as unknown as Response);

    expect(body.status).toBe('degraded');
    expect(body.redis.status).toBe('down');
    expect(body.redis.error).toBe('unreachable');
    expect(response.status).toHaveBeenCalledWith(
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  });
});
