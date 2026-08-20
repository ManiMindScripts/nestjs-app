import { Injectable } from '@nestjs/common';

@Injectable()
export class RealtimeAdapterStatus {
  private degradedReason: string | null = null;
  private degradedSince: string | null = null;

  get isDegraded(): boolean {
    return this.degradedReason !== null;
  }

  get reason(): string | null {
    return this.degradedReason;
  }

  get since(): string | null {
    return this.degradedSince;
  }

  markDegraded(reason: string): void {
    if (this.degradedReason === null) {
      this.degradedSince = new Date().toISOString();
    }
    this.degradedReason = reason;
  }

  markHealthy(): void {
    this.degradedReason = null;
    this.degradedSince = null;
  }
}
