import { describe, expect, it } from 'vitest';

import { InvalidPaginationError } from './errors/invalid-pagination-error';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_INDEX,
  MAX_PAGE_SIZE,
  validatePaginationBounds,
} from './pagination';

/**
 * Unit spec for shared/pagination.ts (CAT-PR1-05).
 *
 * The validator is the single source of truth for pagination defaults + bounds
 * across both layers (DTO in infrastructure; use cases in application) and
 * MUST stay framework-free (no Prisma, no NestJS) so the architecture test
 * (CAT-PR2a-13) can assert it.
 *
 * Scenarios covered (DESIGN §Pagination constants + R5):
 *   - empty input → defaults `page=1, pageSize=20`
 *   - valid pass-through (page=2, pageSize=5)
 *   - reject `page=0` (non-positive)
 *   - reject `pageSize=0` (non-positive)
 *   - reject `pageSize=101` (over max)
 *   - reject `page=1_000_001` (over MAX_PAGE_INDEX)
 *   - every rejection surfaces code `INVALID_PAGINATION` so the controller
 *     envelope matches the spec exactly.
 */
describe('shared/pagination', () => {
  describe('constants', () => {
    it('pins the spec-locked default page size at 20', () => {
      expect(DEFAULT_PAGE_SIZE).toBe(20);
    });

    it('pins the spec-locked max page size at 100', () => {
      expect(MAX_PAGE_SIZE).toBe(100);
    });

    it('pins MAX_PAGE_INDEX at 1_000_000 (defensive upper bound)', () => {
      expect(MAX_PAGE_INDEX).toBe(1_000_000);
    });
  });

  describe('validatePaginationBounds', () => {
    it('applies defaults (page=1, pageSize=20) when input is empty', () => {
      expect(validatePaginationBounds({})).toEqual({ page: 1, pageSize: 20 });
    });

    it('passes valid page and pageSize through unchanged', () => {
      expect(validatePaginationBounds({ page: 2, pageSize: 5 })).toEqual({
        page: 2,
        pageSize: 5,
      });
    });

    it('rejects page=0 with InvalidPaginationError (code INVALID_PAGINATION)', () => {
      try {
        validatePaginationBounds({ page: 0 });
        throw new Error('expected validatePaginationBounds to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidPaginationError);
        expect((err as InvalidPaginationError).code).toBe('INVALID_PAGINATION');
        expect((err as InvalidPaginationError).status).toBe(400);
      }
    });

    it('rejects pageSize=0 with InvalidPaginationError', () => {
      expect(() => validatePaginationBounds({ pageSize: 0 })).toThrow(InvalidPaginationError);
    });

    it('rejects pageSize=101 (over MAX_PAGE_SIZE) with InvalidPaginationError', () => {
      expect(() => validatePaginationBounds({ pageSize: 101 })).toThrow(InvalidPaginationError);
    });

    it('rejects page=1_000_001 (over MAX_PAGE_INDEX) with InvalidPaginationError', () => {
      expect(() => validatePaginationBounds({ page: 1_000_001 })).toThrow(InvalidPaginationError);
    });

    it('accepts the upper boundary values page=MAX_PAGE_INDEX and pageSize=MAX_PAGE_SIZE', () => {
      expect(
        validatePaginationBounds({ page: MAX_PAGE_INDEX, pageSize: MAX_PAGE_SIZE }),
      ).toEqual({ page: MAX_PAGE_INDEX, pageSize: MAX_PAGE_SIZE });
    });
  });
});
