import { NotFoundError } from '../../../shared/errors/not-found-error';
import type { CatalogRepositoryPort } from '../domain/ports/catalog-repository.port';
import type { ArtistDetail } from '../domain/read-models';

/**
 * Get a single artist with embedded album summaries (CAT-PR2a-09).
 *
 * Throws `NotFoundError('artist', id)` (code `NOT_FOUND`, HTTP 404) when the
 * artist does not exist. Returns `ArtistDetail` (artist + album summaries)
 * so the controller can build the `/artists/:id` response in one round-trip.
 *
 * Framework-free by design: only `domain/` + `shared/` imports.
 */
export class GetArtistUseCase {
  constructor(private readonly catalog: CatalogRepositoryPort) {}

  async execute(input: { id: string }): Promise<ArtistDetail> {
    const detail = await this.catalog.findArtistById(input.id);
    if (!detail) throw new NotFoundError('artist', input.id);
    return detail;
  }
}
