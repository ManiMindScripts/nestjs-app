import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { AsyncLocalStorage } from 'async_hooks';

const MAX_HEADER_LENGTH = 64;

/**
 * Threads a correlation/request id through every log line emitted while its
 * context is active. Backed by Node's AsyncLocalStorage, so the id survives
 * async boundaries (e.g. inside resolvers, repository calls, queue jobs)
 * without being plumbed through every method signature. Ids never appear in
 * the request/response body - only in logs, the X-Request-Id header, and
 * metrics correlation - so they carry no user data.
 */
@Injectable()
export class CorrelationService {
  private readonly storage = new AsyncLocalStorage<string>();

  run<T>(id: string, fn: () => T): T {
    return this.storage.run(id, fn);
  }

  getId(): string | undefined {
    return this.storage.getStore();
  }

  generate(): string {
    return randomBytes(16).toString('hex');
  }

  /**
   * Sanitizes a client-supplied id before we echo it back in headers/logs:
   * bounds length and rejects control characters (which could corrupt
   * multi-line structured logs).
   */
  isValidHeader(id: string | undefined): id is string {
    return (
      typeof id === 'string' &&
      id.length > 0 &&
      id.length <= MAX_HEADER_LENGTH &&
      /^[\x21-\x7e]+$/.test(id)
    );
  }
}
