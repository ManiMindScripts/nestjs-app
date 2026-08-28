import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AlertingService } from '../alerting/alerting.service';
import type { MetricsConfig } from './metrics.config';
import { MetricsService } from './metrics.service';

const DEFAULT_POLL_MS = 30_000;

/**
 * Periodically computes the sliding-window 5xx rate and alerts when it
 * breaches the configured threshold. Two guards prevent false alarms and
 * alert fatigue:
 *  - a minimum-sample floor: with very few requests in the window, a single
 *    failure reads as 100% and would fire spuriously during quiet traffic;
 *  - a debounce: once alerted, the monitor stays quiet for a cooldown unless
 *    the rate keeps climbing past a re-arm threshold (so sustained incidents
 *    still escalate without spamming the channel).
 */
@Injectable()
export class ErrorRateMonitor
  implements OnModuleDestroy, OnApplicationShutdown
{
  private readonly logger = new Logger(ErrorRateMonitor.name);
  private timer: NodeJS.Timeout | null = null;
  private lastAlertAt = 0;
  private readonly pollMs: number;

  constructor(
    configService: ConfigService,
    private readonly metricsService: MetricsService,
    private readonly alertingService: AlertingService,
    private readonly config: MetricsConfig,
  ) {
    this.pollMs = Math.max(
      1_000,
      Math.min(config.windowMs / 3, DEFAULT_POLL_MS),
    );
    if (config.enabled) {
      this.maybeStartInterval();
    }
  }

  onModuleDestroy(): void {
    this.stopInterval();
  }

  onApplicationShutdown(): void {
    this.stopInterval();
  }

  /** Runs a manual check (used by the HTTP /metrics path and tests). */
  check(): void {
    const { rate, samples } = this.metricsService.recentErrorRate(
      this.config.windowMs,
    );

    if (samples < this.config.minSamples) {
      this.logger.debug(
        `Error rate ${Math.round(rate * 100)}% ignored: only ${samples} sample(s) in window (floor ${this.config.minSamples})`,
      );
      return;
    }

    if (rate <= this.config.errorRateThreshold) {
      return;
    }

    const now = Date.now();
    const reArm = this.config.alertCooldownMs * 2;
    const withinCooldown = now - this.lastAlertAt < this.config.alertCooldownMs;
    const escalated =
      now - this.lastAlertAt < reArm &&
      rate > this.config.errorRateThreshold + 0.2;

    if (withinCooldown && !escalated) {
      return;
    }

    this.lastAlertAt = now;
    this.alertingService.notify(
      `:rotating_light: 5xx error rate ${Math.round(rate * 100)}% (${samples} requests) over the last ${Math.round(this.config.windowMs / 1000)}s - threshold ${Math.round(this.config.errorRateThreshold * 100)}%. Check /health and /metrics.`,
    );
  }

  private maybeStartInterval(): void {
    const running = this.timer !== null;
    if (running) {
      return;
    }
    this.timer = setInterval(() => this.check(), this.pollMs);
    this.timer.unref();
    this.logger.log(
      `Error-rate monitor active: ${Math.round(this.config.errorRateThreshold * 100)}% threshold over ${Math.round(this.config.windowMs / 1000)}s window, min ${this.config.minSamples} samples`,
    );
  }

  private stopInterval(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
