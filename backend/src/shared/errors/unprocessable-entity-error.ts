import { DomainError } from './domain-error';

/**
 * Raised when a well-formed request references a resource that does not exist
 * (F5 — REQ-P-007 scenario "Unknown trackId is rejected with 422"). Pairs
 * with the additive `UNPROCESSABLE_ENTITY` member of the `ErrorCode` union
 * (design R1).
 *
 * Semantic distinction from the other NOT_FOUND-ish codes:
 *  - `ValidationError` (400) — the payload itself was malformed (e.g. empty
 *    `title`). The request never got far enough to reference anything.
 *  - `NotFoundError` (404) — the addressed resource (the playlist) is missing.
 *  - `UnprocessableEntityError` (422) — the addressed resource exists, but a
 *    referenced secondary resource (the `trackId`) does not resolve.
 *
 * Spec contract: error code `UNPROCESSABLE_ENTITY`, HTTP 422. Mirrors
 * `NotFoundError`'s template (entity + id constructor).
 *
 * Kept framework-agnostic (only `./domain-error` imported) so the playlists
 * use cases can throw it without coupling to the HTTP layer; the existing
 * `GlobalExceptionFilter` surfaces it through the `instanceof DomainError`
 * branch — `codeForStatus` does NOT need a 422 case because no NestJS-thrown
 * `HttpException` ever carries 422 in this codebase.
 */
export class UnprocessableEntityError extends DomainError {
  readonly code = 'UNPROCESSABLE_ENTITY' as const;
  readonly status = 422;

  constructor(entity: string, id: string) {
    super(`${entity} not found: ${id}`);
  }
}
