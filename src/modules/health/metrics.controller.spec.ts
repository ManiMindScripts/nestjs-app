import { ConfigService } from '@nestjs/config';
import { ErrorRateMonitor } from '../../shared/metrics/error-rate.monitor';
import { MetricsConfig } from '../../shared/metrics/metrics.config';
import { MetricsService } from '../../shared/metrics/metrics.service';
import { MetricsController } from './metrics.controller';

describe('MetricsController', () => {
  let metrics: MetricsService;
  let monitor: ErrorRateMonitor;
  let config: ConfigService;
  let controller: MetricsController;
  let checkMock: jest.Mock;

  beforeEach(() => {
    metrics = new MetricsService();
    checkMock = jest.fn();
    monitor = {
      check: checkMock,
    } as unknown as ErrorRateMonitor;
    config = {
      getOrThrow: jest.fn(() => ({ windowMs: 60_000 }) as MetricsConfig),
    } as unknown as ConfigService;
    controller = new MetricsController(metrics, monitor, config);
  });

  it('returns the snapshot and re-evaluates the alert threshold', () => {
    metrics.record('/users', 200, 5);

    const result = controller.metrics();

    expect(checkMock).toHaveBeenCalledTimes(1);
    expect(result.totalRequests).toBe(1);
    expect(result.perRoute[0].route).toBe('/users');
  });
});
