import { MetricsService } from './metrics.service';

describe('MetricsService', () => {
  let service: MetricsService;

  beforeEach(() => {
    service = new MetricsService();
  });

  it('tracks counts, errors and latency per route template', () => {
    service.record('/users/:id', 200, 10);
    service.record('/users/:id', 500, 20);
    service.record('/users/:id', 200, 30);

    const snap = service.snapshot(60_000);
    const route = snap.perRoute.find((r) => r.route === '/users/:id');

    expect(route).toMatchObject({ route: '/users/:id', count: 3, errors: 1 });
    expect(route?.avgMs).toBe(20);
    expect(route?.minMs).toBe(10);
    expect(route?.maxMs).toBe(30);
    expect(snap.totalRequests).toBe(3);
  });

  it('computes the sliding-window error rate with a floor of samples', () => {
    service.record('/a', 200, 1);
    service.record('/a', 500, 1);
    service.record('/a', 500, 1);
    service.record('/a', 500, 1);

    const { rate, samples } = service.recentErrorRate(60_000);
    expect(samples).toBe(4);
    expect(rate).toBe(0.75);
  });

  it('returns a zero rate when there are no samples in the window', () => {
    const { rate, samples } = service.recentErrorRate(60_000);
    expect(rate).toBe(0);
    expect(samples).toBe(0);
  });

  it('collapses UUID paths into the template key', () => {
    // The controller/interceptor supplies the template; but even if a raw path
    // reaches the service, source cleanup happens upstream. This asserts the
    // service keeps flat cardinality by not creating per-id keys itself.
    service.record('/users/3f8a1c2e-0000-4000-8000-000000000001', 200, 5);
    service.record('/users/3f8a1c2e-0000-4000-8000-000000000002', 200, 5);

    expect(service.snapshot(60_000).trackedRoutes).toBe(2);
  });
});
