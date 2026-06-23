import { MAX_PAGE_SIZE } from '../../../shared/pagination';
import { InvalidQueryError } from '../../../shared/errors/invalid-query-error';
import type { CatalogRepositoryPort } from '../domain/ports/catalog-repository.port';
import type { SearchResult } from '../domain/read-models';

/**
 * Grouped full-text search across artists, albums, tracks (CAT-PR3c-01).
 *
 * Sequence:
 *   1. trim `q` and reject empty (`InvalidQueryError`, code `INVALID_QUERY`).
 *      The controller's `validateSearch` wrapper already enforces this via
 *      Zod, but the use case re-checks after trimming so a caller that
 *      bypasses the wrapper (e.g. an `InMemoryCatalogRepository` unit test,
 *      or a future internal caller) cannot reach the port with an empty
 *      query. Spec scenario R6 "Empty query is rejected".
 *   2. delegate to `catalog.search({ q, type, limit: MAX_PAGE_SIZE })`.
 *
 * `MAX_PAGE_SIZE` (spec-locked 100, no env override) caps each group so a
 * wide query like "the" cannot return thousands of rows. Ranking scores are
 * owned by the adapter — they NEVER appear in the response.
 *
 * Framework-free by design: only `domain/` + `shared/` imports.
 */
export class SearchCatalogUseCase {
  constructor(private readonly catalog: CatalogRepositoryPort) {}

  async execute(input: {
    q: string;
    type?: 'artist' | 'album' | 'track';
  }): Promise<SearchResult> {
    const q = input.q.trim();
    if (q.length === 0) throw new InvalidQueryError();
    return this.catalog.search({ q, type: input.type, limit: MAX_PAGE_SIZE });
  }
}
