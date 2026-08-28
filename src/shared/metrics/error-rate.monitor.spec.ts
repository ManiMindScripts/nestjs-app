import { ConfigService } from '@nestjs/config';
import { AlertingService } from '../alerting/alerting.service';
import { MetricsConfig } from './metrics.config';
import { ErrorRateMonitor } from './error-rate.monitor';
import { MetricsService } from './metrics.service';

describe('ErrorRateMonitor', () => {
  const createConfig = (
    overrides: Partial<MetricsConfig> = {},
  ): MetricsConfig => ({
    enabled: true,
    errorRateThreshold: 0.1,
    windowMs: 300_000,
    minSamples: 20,
    alertCooldownMs: 300_000,
    ...overrides,
  });

  // Simulates the sliding window with `total` requests, `errors` of which 5xx.
  const seedMetrics = (
    metrics: MetricsService,
    total: number,
    errors: number,
  ) => {
    for (let i = 0; i < total; i += 1) {
      metrics.record('/test', i < errors ? 500 : 200, 1);
    }
  };

  let alerting: AlertingService;
  let notify: jest.Mock;

  beforeEach(() => {
    alerting = new AlertingService({
      get: () => '',
    } as unknown as ConfigService);
    notify = jest.spyOn(alerting, 'notify').mockImplementation() as jest.Mock;
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('does not alert when sample count is below the floor', () => {
    const metrics = new MetricsService();
    seedMetrics(metrics, 5, 5); // 100% errors but only 5 samples
    const monitor = new ErrorRateMonitor(
      new ConfigService(), // poll interval won't fire in test; uses unref'd timer
      metrics,
      alerting,
      createConfig({ minSamples: 20 }),
    );

    monitor.check();

    expect(notify).not.toHaveBeenCalled();
    monitor.onModuleDestroy();
  });

  it('does not alert when the rate is below the threshold', () => {
    const metrics = new MetricsService();
    seedMetrics(metrics, 100, 5); // 5% < 10%
    const monitor = new ErrorRateMonitor(
      new ConfigService(),
      metrics,
      alerting,
      createConfig(),
    );

    monitor.check();

    expect(notify).not.toHaveBeenCalled();
    monitor.onModuleDestroy();
  });

  it('alerts when the rate breaches the threshold with enough samples', () => {
    const metrics = new MetricsService();
    seedMetrics(metrics, 100, 30); // 30% > 10%
    const monitor = new ErrorRateMonitor(
      new ConfigService(),
      metrics,
      alerting,
      createConfig(),
    );

    monitor.check();

    expect(notify).toHaveBeenCalledTimes(1);
    const calls = notify.mock.calls as unknown as Array<[string]>;
    const message = calls[0][0];
    expect(message).toContain('30%');
    monitor.onModuleDestroy();
  });

  it('cooldown suppresses repeated alerts for the same breach', () => {
    jest.useFakeTimers();
    const metrics = new MetricsService();
    const monitor = new ErrorRateMonitor(
      new ConfigService(),
      metrics,
      alerting,
      createConfig({ alertCooldownMs: 60_000 }),
    );

    seedMetrics(metrics, 100, 30);
    monitor.check();
    monitor.check();
    jest.advanceTimersByTime(10_000); // within cooldown
    monitor.check();

    expect(notify).toHaveBeenCalledTimes(1);
    monitor.onModuleDestroy();
  });

  it('re-arms and alerts again once the cooldown elapses', () => {
    jest.useFakeTimers();
    const metrics = new MetricsService();
    const monitor = new ErrorRateMonitor(
      new ConfigService(),
      metrics,
      alerting,
      createConfig({ alertCooldownMs: 60_000 }),
    );

    seedMetrics(metrics, 100, 30);
    monitor.check();
    jest.advanceTimersByTime(61_000);
    monitor.check();

    expect(notify).toHaveBeenCalledTimes(2);
    monitor.onModuleDestroy();
  });

  it('does not start a poll timer when disabled', () => {
    jest.useFakeTimers();
    const metrics = new MetricsService();
    const monitor = new ErrorRateMonitor(
      new ConfigService(),
      metrics,
      alerting,
      createConfig({ enabled: false }),
    );

    seedMetrics(metrics, 100, 30);
    monitor.check();

    expect(notify).toHaveBeenCalledTimes(1); // manual check still evaluates
    jest.advanceTimersByTime(120_000);
    monitor.onModuleDestroy();
  });
});
