import type { CatalogRepositoryPort } from '../../catalog/domain/ports/catalog-repository.port';
import type { AlbumSummary } from '../../catalog/domain/read-models';
import type { LibraryRepositoryPort } from '../domain/ports/library-repository.port';

/**
 * Minimal logger port for the silent-omit warn (F6 — design §6).
 *
 * Kept framework-free (no `@nestjs/common` LoggerService import) so the
 * application layer stays decoupled. `AppLogger` (backend/src/logger.ts)
 * satisfies this shape structurally — mirrors F5's `PlaylistLoggerPort`.
 */
export interface LibraryLoggerPort {
  warn(message: string, context: Record<string, unknown>): void;
}

/** One hydrated saved-album entry (hand-synced by the frontend as SavedAlbum). */
export interface SavedAlbum {
  album: AlbumSummary;
  addedAt: Date;
}

/**
 * List the caller's saved albums, hydrated + recency-ordered (F6 — REQ-L-003).
 *
 * Composition:
 *  1. `repo.listByUser` — the caller's rows, port-guaranteed `added_at` desc.
 *  2. `catalog.findAlbumByIds(albumIds)` (cross-context — order NOT
 *     guaranteed by the port contract, REQ-L-005).
 *  3. Silent-omit: unresolved ids are dropped from the result AND logged at
 *     warn level with the pinned shape `{ userId, omittedAlbumIds[], count }`.
 *     Silent to the caller (no error envelope), observable to the operator.
 *  4. Build `SavedAlbum[]` ITERATING THE REPO ROWS' order — preserves recency
 *     AND re-sorts defensively against any catalog ordering drift (REQ-L-003
 *     "regardless of the order the hydration source returned").
 *
 * Framework-free by design: type-only import of the catalog port + read-model.
 */
export class ListLibraryUseCase {
  constructor(
    private readonly library: LibraryRepositoryPort,
    private readonly catalog: CatalogRepositoryPort,
    private readonly logger: LibraryLoggerPort,
  ) {}

  async execute(input: { userId: string }): Promise<SavedAlbum[]> {
    const rows = await this.library.listByUser(input.userId);
    const albumIds = rows.map((r) => r.albumId);
    const found = await this.catalog.findAlbumByIds(albumIds);
    const foundById = new Map(found.map((a) => [a.id, a]));

    // Silent-omit: warn on unresolved refs (same posture as F5's broken-track
    // rule) — survivors stay recency-ordered, no error surfaced.
    const omittedAlbumIds = albumIds.filter((id) => !foundById.has(id));
    if (omittedAlbumIds.length > 0) {
      this.logger.warn('Library hydration omitted unresolved album references', {
        userId: input.userId,
        omittedAlbumIds,
        count: omittedAlbumIds.length,
      });
    }

    // Iterate rows in port-guaranteed added_at desc order — recency comes
    // from the repo rows, never from the hydration source's return order.
    const saved: SavedAlbum[] = [];
    for (const row of rows) {
      const album = foundById.get(row.albumId);
      if (album) saved.push({ album, addedAt: row.addedAt });
    }
    return saved;
  }
}
