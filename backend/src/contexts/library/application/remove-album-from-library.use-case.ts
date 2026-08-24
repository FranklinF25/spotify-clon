import type { LibraryRepositoryPort } from '../domain/ports/library-repository.port';

/**
 * Remove an album from the caller's library (F6 — REQ-L-004).
 *
 * Composition: `repo.removeAlbum` only. NO catalog call, NO existence check
 * — removal is IDEMPOTENT regardless of catalog state (deleting a pair that
 * has no row deletes 0 rows; no 404, no 409 path exists).
 *
 * Returns void (the HTTP layer answers 204).
 *
 * Framework-free by design: only the `domain/` port.
 */
export class RemoveAlbumFromLibraryUseCase {
  constructor(private readonly library: LibraryRepositoryPort) {}

  async execute(input: { userId: string; albumId: string }): Promise<void> {
    await this.library.removeAlbum(input);
  }
}
