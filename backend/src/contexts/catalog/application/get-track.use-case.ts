import { NotFoundError } from '../../../shared/errors/not-found-error';
import type { CatalogRepositoryPort } from '../domain/ports/catalog-repository.port';
import type { Track } from '../domain/track.entity';

/**
 * Get a single track by id (CAT-PR2a-12).
 *
 * Returns the `Track` ENTITY (NOT a projection) — the controller calls
 * `.toPrimitive()` to drop `filePath` for the HTTP response. The entity keeps
 * `filePath` as a public readonly field so the future `playback` context can
 * read it via `CatalogRepositoryPort.findTrackById`.
 *
 * Throws `NotFoundError('track', id)` (code `NOT_FOUND`, HTTP 404) when the
 * track does not exist.
 *
 * Framework-free by design: only `domain/` + `shared/` imports.
 */
export class GetTrackUseCase {
  constructor(private readonly catalog: CatalogRepositoryPort) {}

  async execute(input: { id: string }): Promise<Track> {
    const track = await this.catalog.findTrackById(input.id);
    if (!track) throw new NotFoundError('track', input.id);
    return track;
  }
}
