import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const ALERT_TIMEOUT_MS = 5_000;

/**
 * Fire-and-forget alerting sink for failures that exhausted every retry.
 * Delivery is best-effort by design: an alerting outage must never take down
 * or slow down the code path reporting the problem. With no webhook
 * configured this degrades to a debug log, so callers can wire it in
 * unconditionally.
 */
@Injectable()
export class AlertingService {
  private readonly logger = new Logger(AlertingService.name);
  private readonly webhookUrl: string;

  constructor(configService: ConfigService) {
    this.webhookUrl =
      configService.get<string>('ALERT_SLACK_WEBHOOK_URL') ?? '';
  }

  notify(text: string): void {
    if (!this.webhookUrl) {
      this.logger.debug(`Alert (no webhook configured): ${text}`);
      return;
    }

    void fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(ALERT_TIMEOUT_MS),
    })
      .then((response) => {
        if (!response.ok) {
          this.logger.warn(
            `Alert webhook responded ${response.status}; alert dropped`,
          );
        }
      })
      .catch((error: unknown) => {
        this.logger.warn(
          `Alert webhook delivery failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
  }
}
