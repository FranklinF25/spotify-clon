import { type ErrorDetail, DomainError } from './domain-error';

/**
 * Raised by `validatePaginationBounds` (shared/pagination.ts) when a page or
 * page-size parameter falls outside the spec-locked bounds.
 *
 * Spec contract: error code `INVALID_PAGINATION`, HTTP 400 (DESIGN §Shared
 * error additions + R5 "Non-positive or over-max pagination is rejected").
 *
 * Created here as the minimal class needed by `validatePaginationBounds`; the
 * full `ErrorCode` union extension (adding `'INVALID_PAGINATION'` as a first
 * class member) lands in CAT-PR2a-01 along with `NotFoundError` and
 * `InvalidQueryError`.
 */
export class InvalidPaginationError extends DomainError {
  readonly code = 'INVALID_PAGINATION' as const;
  readonly status = 400;

  constructor(message = 'Invalid pagination parameters', details?: ErrorDetail[]) {
    super(message, details);
  }
}
