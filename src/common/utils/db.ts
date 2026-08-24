import { ConflictException } from '@nestjs/common';

export function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  );
}

/**
 * Rethrows Postgres unique-violation errors (23505) as an HTTP 409 with the
 * given message; every other error is rethrown untouched. Call from catch
 * blocks that guard against concurrent-insert races.
 */
export function rethrowConflictOrOriginal(
  error: unknown,
  conflictMessage: string,
): never {
  if (isUniqueViolation(error)) {
    throw new ConflictException(conflictMessage);
  }
  throw error;
}
