import { NotFoundError } from '../../../shared/errors/not-found-error';
import type { CatalogRepositoryPort } from '../domain/ports/catalog-repository.port';
import type { AlbumDetail } from '../domain/read-models';

/**
 * Get a single album with embedded artist summary + tracks (CAT-PR2a-11).
 *
 * Throws `NotFoundError('album', id)` (code `NOT_FOUND`, HTTP 404) when the
 * album does not exist. Returns `AlbumDetail` (album + artist summary +
 * tracks[]) so the controller can build the `/albums/:id` response in one
 * round-trip.
 *
 * Framework-free by design: only `domain/` + `shared/` imports.
 */
export class GetAlbumUseCase {
  constructor(private readonly catalog: CatalogRepositoryPort) {}

  async execute(input: { id: string }): Promise<AlbumDetail> {
    const detail = await this.catalog.findAlbumById(input.id);
    if (!detail) throw new NotFoundError('album', input.id);
    return detail;
  }
}
