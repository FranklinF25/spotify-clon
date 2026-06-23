import { InvalidQueryError } from '../../../../shared/errors/invalid-query-error';
import { ValidationError } from '../../../../shared/errors/validation-error';
import { validate } from '../../../identity/infrastructure/dto/validate';
import { searchSchema } from './search.dto';

/**
 * Edge-validation wrapper for search query params (CAT-PR2b1-03).
 *
 * Wraps identity's `validate(searchSchema, input)` and re-throws any
 * `ValidationError` as `InvalidQueryError` so the spec-pinned
 * `INVALID_QUERY` token reaches the client (R6 "Empty query is rejected").
 * Non-`ValidationError` exceptions pass through untouched.
 *
 * Controller endpoints MUST call THIS wrapper (NOT the raw `validate()`)
 * so the spec-pinned error code is what the client sees.
 */
export function validateSearch(input: unknown): {
  q: string;
  type?: 'artist' | 'album' | 'track';
} {
  try {
    return validate(searchSchema, input);
  } catch (err) {
    if (err instanceof ValidationError) {
      throw new InvalidQueryError(err.message);
    }
    throw err;
  }
}
