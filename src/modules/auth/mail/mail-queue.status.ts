import { Injectable } from '@nestjs/common';

interface PermanentFailure {
  reason: string;
  at: string;
}

/**
 * Tracks the last mail job that exhausted every retry, mirroring the
 * RealtimeAdapterStatus pattern so /health can surface SMTP outages the same
 * way it surfaces a degraded socket adapter.
 */
@Injectable()
export class MailQueueStatus {
  private lastPermanentFailure: PermanentFailure | null = null;

  markPermanentFailure(reason: string): void {
    this.lastPermanentFailure = {
      reason,
      at: new Date().toISOString(),
    };
  }

  get failure(): PermanentFailure | null {
    return this.lastPermanentFailure;
  }
}
