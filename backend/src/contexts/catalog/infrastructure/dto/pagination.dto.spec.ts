import { describe, expect, it } from 'vitest';

import { MAX_PAGE_INDEX, MAX_PAGE_SIZE } from '../../../../shared/pagination';
import { paginationSchema } from './pagination.dto';

/**
 * paginationSchema unit specs (CAT-PR2b1-01).
 *
 * Pins the Zod schema used by the `validatePagination` wrapper:
 *  - `page` / `pageSize` are both OPTIONAL (no `.default()` baked in —
 *    defaults are applied by `validatePaginationBounds` in the use case).
 *  - Bounds use the spec-locked constants `MAX_PAGE_INDEX` + `MAX_PAGE_SIZE`
 *    (single source of truth in shared/pagination.ts, R2-W-S2).
 *  - Coercion lets `?page=2` strings reach the schema cleanly.
 */
describe('paginationSchema', () => {
  it('accepts an empty object (both fields optional, no defaults baked in)', () => {
    const parsed = paginationSchema.parse({});

    expect(parsed).toEqual({});
  });

  it('accepts and round-trips valid page + pageSize', () => {
    const parsed = paginationSchema.parse({ page: 2, pageSize: 5 });

    expect(parsed).toEqual({ page: 2, pageSize: 5 });
  });

  it('coerces numeric strings (query-string origin)', () => {
    const parsed = paginationSchema.parse({ page: '2', pageSize: '5' });

    expect(parsed).toEqual({ page: 2, pageSize: 5 });
  });

  it('rejects page=0 (non-positive)', () => {
    expect(() => paginationSchema.parse({ page: 0 })).toThrow();
  });

  it('rejects pageSize=0 (non-positive)', () => {
    expect(() => paginationSchema.parse({ pageSize: 0 })).toThrow();
  });

  it(`rejects pageSize over MAX_PAGE_SIZE (${MAX_PAGE_SIZE})`, () => {
    expect(() => paginationSchema.parse({ pageSize: MAX_PAGE_SIZE + 1 })).toThrow();
  });

  it(`rejects page over MAX_PAGE_INDEX (${MAX_PAGE_INDEX})`, () => {
    expect(() => paginationSchema.parse({ page: MAX_PAGE_INDEX + 1 })).toThrow();
  });

  it('rejects non-integer page', () => {
    expect(() => paginationSchema.parse({ page: 1.5 })).toThrow();
  });

  it('rejects negative pageSize', () => {
    expect(() => paginationSchema.parse({ pageSize: -1 })).toThrow();
  });
});
