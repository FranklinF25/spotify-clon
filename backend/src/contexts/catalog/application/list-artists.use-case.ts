import { validatePaginationBounds } from '../../../shared/pagination';
import type { CatalogRepositoryPort } from '../domain/ports/catalog-repository.port';
import type { ArtistSummary, PaginatedResult } from '../domain/read-models';

/**
 * List artists with offset pagination (CAT-PR2a-08).
 *
 * Sequence:
 *   1. `validatePaginationBounds(input)` — applies defaults (page=1,
 *      pageSize=20) and throws `InvalidPaginationError` for non-positive or
 *      over-max values. Single source of truth shared with the DTO (R2-W-S2).
 *   2. delegate to `catalog.listArtists({ page, pageSize })`.
 *
 * Out-of-range pages return `items: []` with accurate `total` (spec-locked
 * R5 — a page index is a window, not a resource, so "no items at offset N"
 * is data, not an error).
 *
 * Framework-free by design: only `domain/` + `shared/` imports.
 */
export class ListArtistsUseCase {
  constructor(private readonly catalog: CatalogRepositoryPort) {}

  async execute(input: {
    page?: number;
    pageSize?: number;
  }): Promise<PaginatedResult<ArtistSummary>> {
    const { page, pageSize } = validatePaginationBounds(input);
    return this.catalog.listArtists({ page, pageSize });
  }
}
