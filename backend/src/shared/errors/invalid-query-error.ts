import { DomainError } from './domain-error';

/**
 * Raised by the catalog search use case (and the `validateSearch` wrapper)
 * when a search query is empty or whitespace-only after trimming
 * (DESIGN §Shared error additions + R6 "Empty query is rejected").
 *
 * Spec contract: error code `INVALID_QUERY`, HTTP 400.
 */
export class InvalidQueryError extends DomainError {
  readonly code = 'INVALID_QUERY' as const;
  readonly status = 400;

  constructor(message = 'Search query must not be empty') {
    super(message);
  }
}
