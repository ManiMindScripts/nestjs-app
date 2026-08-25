import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { AlertingService } from './alerting.service';

describe('AlertingService', () => {
  const buildService = async (webhookUrl: string): Promise<AlertingService> => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        AlertingService,
        { provide: ConfigService, useValue: { get: () => webhookUrl } },
      ],
    }).compile();

    return moduleRef.get(AlertingService);
  };

  let debugSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    debugSpy = jest.spyOn(Logger.prototype, 'debug').mockImplementation();
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('is a debug no-op without a configured webhook', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    const service = await buildService('');

    service.notify('something broke');

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining('something broke'),
    );
  });

  it('posts fire-and-forget alerts to the configured webhook', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({ ok: true } as Response);
    const service = await buildService('https://hooks.example.com/t/b/c');

    service.notify(':rotating_light: mail down');
    await Promise.resolve(); // let the floating promise settle

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://hooks.example.com/t/b/c',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ text: ':rotating_light: mail down' }),
      }),
    );
  });

  it('warns but does not throw on webhook errors', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new Error('network unreachable'));
    const service = await buildService('https://hooks.example.com/t/b/c');

    expect(() => service.notify('boom')).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('network unreachable'),
    );
  });
});
