import type { CatalogRepositoryPort } from '../../catalog/domain/ports/catalog-repository.port';
import { UnprocessableEntityError } from '../../../shared/errors/unprocessable-entity-error';
import type { LibraryRepositoryPort } from '../domain/ports/library-repository.port';

/**
 * Save a catalog album to the caller's library (F6 — REQ-L-002).
 *
 * Composition: catalog `findAlbumByIds([albumId])` MUST return 1 row
 * (existence validated BEFORE any write — the F5 add-track precedent,
 * LOCKED decision #8) → `repo.addAlbum` (upsert always resetting `addedAt`
 * — LOCKED decision #3; re-save moves the album to the top, never 409).
 *
 * Returns void (the HTTP layer answers 204).
 *
 * Cross-context: consumes `CatalogRepositoryPort` type-only — the concrete
 * adapter is banned by the cross-context ESLint rule.
 *
 * Framework-free by design: only `domain/` + `shared/` + the catalog port
 * type-only import.
 */
export class AddAlbumToLibraryUseCase {
  constructor(
    private readonly library: LibraryRepositoryPort,
    private readonly catalog: CatalogRepositoryPort,
  ) {}

  async execute(input: {
    userId: string;
    albumId: string;
    now: Date;
  }): Promise<void> {
    // Validate BEFORE any write (REQ-L-002): an unresolvable albumId means
    // 422 with zero rows written.
    const [found] = await this.catalog.findAlbumByIds([input.albumId]);
    if (!found) {
      throw new UnprocessableEntityError('album', input.albumId);
    }

    await this.library.addAlbum({
      userId: input.userId,
      albumId: input.albumId,
      now: input.now,
    });
  }
}
