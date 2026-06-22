import { DomainError } from './domain-error';

/**
 * Raised by the catalog detail use cases when a lookup returns null
 * (DESIGN §Shared error additions + R2/R3/R4 "not found" scenarios).
 *
 * Spec contract: error code `NOT_FOUND`, HTTP 404. Reuses the existing
 * `NOT_FOUND` member of the `ErrorCode` union rather than introducing a
 * catalog-specific code — the vocabulary is shared across contexts.
 */
export class NotFoundError extends DomainError {
  readonly code = 'NOT_FOUND' as const;
  readonly status = 404;

  constructor(entity: string, id: string) {
    super(`${entity} not found: ${id}`);
  }
}
