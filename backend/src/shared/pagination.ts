import { InvalidPaginationError } from './errors/invalid-pagination-error';

/**
 * Spec-locked default page size for catalog list endpoints (R5).
 *
 * Compile-time constant — no env override surface. R2-CRIT-4: the spec pins
 * `pageSize=20` as the default; allowing env to change it would let operators
 * violate the contract. Both the DTO (infrastructure) and the use cases
 * (application) read this same source of truth.
 */
export const DEFAULT_PAGE_SIZE = 20;

/**
 * Spec-locked hard maximum page size for catalog list endpoints (R5).
 *
 * The DTO enforces this via Zod `.max(MAX_PAGE_SIZE)`; the use case re-checks
 * via {@link validatePaginationBounds} so an `InMemoryCatalogRepository` fake
 * that bypasses the controller still cannot exceed it.
 */
export const MAX_PAGE_SIZE = 100;

/**
 * Defensive upper bound on the page index (Round 1 W-T4 carry-over).
 *
 * The spec does not pin this, but allowing unbounded `page` lets a client
 * trigger O(N²) OFFSET scans — the cost of `OFFSET k` grows with `k`. One
 * million is well above any legitimate portfolio-scale use case and any
 * pager that legitimately needs more should switch to cursor pagination.
 */
export const MAX_PAGE_INDEX = 1_000_000;

/**
 * Normalize + bounds-check `{ page?, pageSize? }` against the spec-locked
 * constants. Applies {@link DEFAULT_PAGE_SIZE} when `pageSize` is omitted and
 * `1` when `page` is omitted, then throws {@link InvalidPaginationError} for
 * non-positive or over-max values.
 *
 * Single source of truth — called by every catalog list use case after the
 * DTO has done its Zod-side parse. The controller-side wrapper
 * (`validatePagination`) translates Zod issues into the same
 * {@link InvalidPaginationError} so the spec-pinned `INVALID_PAGINATION`
 * token reaches the client regardless of which layer rejects first.
 */
export function validatePaginationBounds(input: {
  page?: number;
  pageSize?: number;
}): { page: number; pageSize: number } {
  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? DEFAULT_PAGE_SIZE;
  if (page < 1) throw new InvalidPaginationError('page must be >= 1');
  if (page > MAX_PAGE_INDEX)
    throw new InvalidPaginationError(`page must be <= ${MAX_PAGE_INDEX}`);
  if (pageSize < 1) throw new InvalidPaginationError('pageSize must be >= 1');
  if (pageSize > MAX_PAGE_SIZE)
    throw new InvalidPaginationError(`pageSize must be <= ${MAX_PAGE_SIZE}`);
  return { page, pageSize };
}
