/**
 * Stable error code vocabulary shared across the API surface (DESIGN §4.3).
 *
 * Catalog additions:
 *  - `INVALID_PAGINATION` (PR-1) — `InvalidPaginationError` (shared/pagination.ts).
 *  - `INVALID_QUERY` (PR-2a) — `InvalidQueryError` (catalog search empty-q).
 * `NOT_FOUND` was already in the vocabulary; catalog reuses it via
 * `NotFoundError` rather than introducing a catalog-specific code.
 *
 * Playlists addition (F5 — design R1):
 *  - `UNPROCESSABLE_ENTITY` — `UnprocessableEntityError`. Covers REQ-P-007
 *    scenario "Unknown trackId is rejected with 422": a well-formed request
 *    that references a non-existent resource (the `trackId` IS a valid UUID,
 *    it just does not resolve). Distinct from `VALIDATION_ERROR` (400,
 *    malformed payload) and `NOT_FOUND` (404, the addressed resource itself
 *    is missing). Keeps the 1:1 code↔status correspondence that
 *    `GlobalExceptionFilter.codeForStatus` and the frontend
 *    `FORM_OWNED_CODES` filter both implicitly assume.
 */
export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INTERNAL_ERROR'
  | 'INVALID_PAGINATION'
  | 'INVALID_QUERY'
  | 'UNPROCESSABLE_ENTITY';

/**
 * Field-level detail attached to validation errors.
 */
export interface ErrorDetail {
  field: string;
  issue: string;
}

/**
 * Base class for all domain/business errors that must surface over HTTP in the
 * standard `{ error: { code, message, details? } }` envelope.
 *
 * Subclasses pin a stable `code` and HTTP `status`. `details` is optional and
 * reserved for field-level validation feedback.
 *
 * Kept framework-agnostic (no NestJS import) so the identity domain and use
 * cases can throw these without coupling to the HTTP layer.
 */
export abstract class DomainError extends Error {
  abstract readonly code: ErrorCode;
  abstract readonly status: number;

  readonly details?: ErrorDetail[];

  constructor(message: string, details?: ErrorDetail[]) {
    super(message);
    this.name = this.constructor.name;
    this.details = details;
    // Restore prototype chain for `instanceof` under ES5/ES2015 targets.
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /** Serializes the public envelope body (without the outer `error` wrapper). */
  toJSON(): { code: ErrorCode; message: string; details?: ErrorDetail[] } {
    if (this.details && this.details.length > 0) {
      return { code: this.code, message: this.message, details: this.details };
    }
    return { code: this.code, message: this.message };
  }
}
