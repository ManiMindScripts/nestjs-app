import { ConflictException } from '@nestjs/common';
import { isUniqueViolation, rethrowConflictOrOriginal } from './db';

describe('db utils', () => {
  describe('isUniqueViolation', () => {
    it('recognizes Postgres error code 23505', () => {
      const error = Object.assign(new Error('duplicate key'), {
        code: '23505',
      });
      expect(isUniqueViolation(error)).toBe(true);
    });

    it('rejects other error codes', () => {
      const error = Object.assign(new Error('other'), { code: '23503' });
      expect(isUniqueViolation(error)).toBe(false);
    });

    it('rejects non-error and code-less values', () => {
      expect(isUniqueViolation('string')).toBe(false);
      expect(isUniqueViolation(new Error('no code'))).toBe(false);
      expect(isUniqueViolation(undefined)).toBe(false);
    });
  });

  describe('rethrowConflictOrOriginal', () => {
    it('rethrows a unique violation as 409', () => {
      const error = Object.assign(new Error('duplicate'), { code: '23505' });
      expect(() => rethrowConflictOrOriginal(error, 'Already exists')).toThrow(
        ConflictException,
      );
    });

    it('rethrows the original error untouched otherwise', () => {
      const error = new Error('boom');
      expect(() => rethrowConflictOrOriginal(error, 'Already exists')).toThrow(
        'boom',
      );
    });
  });
});
