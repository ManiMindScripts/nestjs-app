import { Injectable } from '@nestjs/common';

@Injectable()
export class RealtimeAdapterStatus {
  private attached = false;
  private degradedReason: string | null = null;
  private degradedSince: string | null = null;

  get isAttached(): boolean {
    return this.attached;
  }

  get isDegraded(): boolean {
    return this.degradedReason !== null;
  }

  get reason(): string | null {
    return this.degradedReason;
  }

  get since(): string | null {
    return this.degradedSince;
  }

  markAttached(): void {
    this.attached = true;
    this.degradedReason = null;
    this.degradedSince = null;
  }

  markDegraded(reason: string): void {
    this.attached = false;
    if (this.degradedReason === null) {
      this.degradedSince = new Date().toISOString();
    }
    this.degradedReason = reason;
  }
}
