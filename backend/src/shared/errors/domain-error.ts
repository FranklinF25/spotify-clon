/**
 * Stable error code vocabulary shared across the API surface (DESIGN §4.3).
 *
 * PR-1 adds `INVALID_PAGINATION` so `InvalidPaginationError` (shared/pagination.ts)
 * satisfies the `DomainError` contract. PR-2a will extend this further with
 * `INVALID_QUERY` (catalog search).
 */
export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INTERNAL_ERROR'
  | 'INVALID_PAGINATION';

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
