import { InvalidPaginationError } from '../../../../shared/errors/invalid-pagination-error';
import { ValidationError } from '../../../../shared/errors/validation-error';
import { validate } from '../../../identity/infrastructure/dto/validate';
import { paginationSchema } from './pagination.dto';

/**
 * Edge-validation wrapper for pagination query params (CAT-PR2b1-03).
 *
 * Wraps identity's `validate(paginationSchema, input)` and re-throws any
 * `ValidationError` as `InvalidPaginationError` so the spec-pinned
 * `INVALID_PAGINATION` token reaches the client (R3-W-3 — the raw
 * `validate()` would surface the generic `VALIDATION_ERROR` code and
 * violate the spec contract). Non-`ValidationError` exceptions pass
 * through untouched.
 *
 * Controller endpoints MUST call THIS wrapper (NOT the raw `validate()`)
 * so the spec-pinned error code is what the client sees.
 */
export function validatePagination(input: unknown): { page?: number; pageSize?: number } {
  try {
    return validate(paginationSchema, input);
  } catch (err) {
    if (err instanceof ValidationError) {
      throw new InvalidPaginationError(err.message, err.details);
    }
    throw err;
  }
}
