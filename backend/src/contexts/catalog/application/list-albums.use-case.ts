import { validatePaginationBounds } from '../../../shared/pagination';
import type { CatalogRepositoryPort } from '../domain/ports/catalog-repository.port';
import type { AlbumSummary, PaginatedResult } from '../domain/read-models';

/**
 * List albums with offset pagination (CAT-PR2a-10).
 *
 * Mirrors {@link ListArtistsUseCase} against `catalog.listAlbums`. Each
 * returned `AlbumSummary` carries an embedded `ArtistSummary` so list
 * consumers can render "Album One — by Artist One" in one round-trip.
 *
 * Framework-free by design: only `domain/` + `shared/` imports.
 */
export class ListAlbumsUseCase {
  constructor(private readonly catalog: CatalogRepositoryPort) {}

  async execute(input: {
    page?: number;
    pageSize?: number;
  }): Promise<PaginatedResult<AlbumSummary>> {
    const { page, pageSize } = validatePaginationBounds(input);
    return this.catalog.listAlbums({ page, pageSize });
  }
}
