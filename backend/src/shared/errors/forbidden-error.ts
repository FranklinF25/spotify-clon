import { DomainError } from './domain-error';

/**
 * Raised by mutation use cases when a caller tries to mutate a playlist they
 * do not own (F5 — REQ-P-011 scenario "Non-owner mutation returns 403
 * FORBIDDEN"). Closes the vocab-vs-class gap: `FORBIDDEN` has been in the
 * `ErrorCode` union since identity but had no class.
 *
 * Reuses the existing `FORBIDDEN` member of the `ErrorCode` union — NO
 * vocabulary change (LOCKED product decision #1 + technical fork #7).
 *
 * Spec contract: error code `FORBIDDEN`, HTTP 403. Mirrors `NotFoundError`'s
 * template (entity + id constructor) line for line.
 *
 * Kept framework-agnostic (only `./domain-error` imported) so the playlists
 * domain and use cases can throw it without coupling to the HTTP layer; the
 * existing `GlobalExceptionFilter` already maps it through the
 * `instanceof DomainError` branch.
 */
export class ForbiddenError extends DomainError {
  readonly code = 'FORBIDDEN' as const;
  readonly status = 403;

  constructor(entity: string, id: string) {
    super(`${entity} access forbidden: ${id}`);
  }
}
