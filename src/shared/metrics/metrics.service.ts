import { Injectable, Logger } from '@nestjs/common';

/**
 * In-memory, dependency-free request metrics. Deliberately bounded so a
 * misbehaving endpoint can never grow the structure without limit:
 *  - per-route counters are keyed by the router template (e.g. /users/:id),
 *    never a raw path with a UUID, so cardinality stays flat;
 *  - the sliding error window keeps only timestamped status codes (no
 *    messages/stacks), so nothing sensitive can leak through /metrics.
 *
 * This is a lightweight foundation; swapping in Prometheus/OpenTelemetry later
 * means replacing this service's surface, not the instrumentation call sites.
 */
@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);

  /** Max distinct route templates tracked; evicts on overflow. */
  private static readonly MAX_ROUTES = 500;
  /** Fixed capacity of the sliding window of (time, status, route) samples. */
  private static readonly WINDOW_CAPACITY = 20_000;

  private readonly routes = new Map<string, RouteMetric>();
  private readonly samples: WindowSample[] = [];
  private nextSampleIndex = 0;
  private totalRequests = 0;
  private readonly windowStartMs = Date.now();

  /**
   * Record one completed request (status code known). Internal bookkeeping is
   * defensive: metrics must never throw into or slow the request path.
   */
  record(route: string, statusCode: number, durationMs: number): void {
    this.totalRequests += 1;

    const metric = this.routes.get(route);
    if (metric) {
      metric.count += 1;
      if (statusCode >= 500) {
        metric.errors += 1;
      }
      metric.latencySumMs += durationMs;
      metric.latencyMinMs = Math.min(metric.latencyMinMs, durationMs);
      metric.latencyMaxMs = Math.max(metric.latencyMaxMs, durationMs);
    } else if (this.routes.size < MetricsService.MAX_ROUTES) {
      this.routes.set(route, {
        count: 1,
        errors: statusCode >= 500 ? 1 : 0,
        latencySumMs: durationMs,
        latencyMinMs: durationMs,
        latencyMaxMs: durationMs,
      });
    } else {
      this.logger.warn(
        `Metrics route table full (${MetricsService.MAX_ROUTES}); dropping route ${route}`,
      );
    }

    this.pushSample(route, statusCode);
  }

  /**
   * Fraction of requests in the last `windowMs` that ended 5xx, or 0 when
   * there are no samples in the window.
   */
  recentErrorRate(windowMs: number): { rate: number; samples: number } {
    const cutoff = Date.now() - windowMs;
    let total = 0;
    let errors = 0;

    for (const sample of this.samples) {
      if (sample.timestamp < cutoff) {
        continue;
      }
      total += 1;
      if (sample.statusCode >= 500) {
        errors += 1;
      }
    }

    return { rate: total === 0 ? 0 : errors / total, samples: total };
  }

  snapshot(windowMs: number, now = Date.now()): MetricsSnapshot {
    const { rate, samples } = this.recentErrorRate(windowMs);

    const perRoute: RouteSnapshot[] = [];
    for (const [route, m] of this.routes) {
      perRoute.push({
        route,
        count: m.count,
        errors: m.errors,
        avgMs: m.count === 0 ? 0 : Math.round(m.latencySumMs / m.count),
        minMs: m.latencyMinMs,
        maxMs: m.latencyMaxMs,
      });
    }
    perRoute.sort((a, b) => b.count - a.count);

    return {
      totalRequests: this.totalRequests,
      trackedRoutes: perRoute.length,
      window: {
        windowMs,
        sampledSince: new Date(this.windowStartMs).toISOString(),
        sampledAt: new Date(now).toISOString(),
        errorRate: Math.round(rate * 1000) / 1000,
        samples,
      },
      perRoute,
    };
  }

  private pushSample(route: string, statusCode: number): void {
    if (this.samples.length < MetricsService.WINDOW_CAPACITY) {
      this.samples.push({ timestamp: Date.now(), route, statusCode });
      return;
    }
    this.samples[this.nextSampleIndex] = {
      timestamp: Date.now(),
      route,
      statusCode,
    };
    this.nextSampleIndex =
      (this.nextSampleIndex + 1) % MetricsService.WINDOW_CAPACITY;
  }
}

interface RouteMetric {
  count: number;
  errors: number;
  latencySumMs: number;
  latencyMinMs: number;
  latencyMaxMs: number;
}

interface WindowSample {
  timestamp: number;
  route: string;
  statusCode: number;
}

export interface RouteSnapshot {
  route: string;
  count: number;
  errors: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
}

export interface MetricsSnapshot {
  totalRequests: number;
  trackedRoutes: number;
  window: {
    windowMs: number;
    sampledSince: string;
    sampledAt: string;
    errorRate: number;
    samples: number;
  };
  perRoute: RouteSnapshot[];
}
