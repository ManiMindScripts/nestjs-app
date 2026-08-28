import { registerAs } from '@nestjs/config';

export interface MetricsConfig {
  enabled: boolean;
  /** Fraction [0,1] of 5xx responses in the window that triggers an alert. */
  errorRateThreshold: number;
  /** Sliding window over which the 5xx rate is computed. */
  windowMs: number;
  /** Minimum requests seen in the window before the threshold is evaluated. */
  minSamples: number;
  /** Debounce between consecutive alerts for the same breach. */
  alertCooldownMs: number;
}

export const metricsConfig = registerAs('metrics', (): MetricsConfig => {
  const env = process.env;

  return {
    enabled: (env.METRICS_ENABLED ?? 'true').toLowerCase() === 'true',
    errorRateThreshold: parseFloat(env.METRICS_ERROR_RATE_THRESHOLD ?? '0.1'),
    windowMs: parseInt(env.METRICS_WINDOW_MS ?? '300000', 10),
    minSamples: parseInt(env.METRICS_MIN_SAMPLES ?? '20', 10),
    alertCooldownMs: parseInt(env.METRICS_ALERT_COOLDOWN_MS ?? '300000', 10),
  };
});
