import type { CatalogRepositoryPort } from '../../catalog/domain/ports/catalog-repository.port';
import { NotFoundError } from '../../../shared/errors/not-found-error';
import type { Track } from '../../catalog/domain/track.entity';
import type { PlaylistsRepositoryPort } from '../domain/ports/playlists-repository.port';

/**
 * Minimal logger port for the silent-omit warn (F5 — design §13).
 *
 * Kept framework-free (no `@nestjs/common` LoggerService import) so the
 * application layer stays decoupled. `AppLogger` (backend/src/logger.ts)
 * satisfies this shape — its `warn(message, ...optional)` accepts a context
 * object as the second arg via the `buildMerge` helper. The PR-2 module
 * wiring binds `{ provide: PlaylistLoggerPort, useExisting: AppLogger }`.
 */
export interface PlaylistLoggerPort {
  warn(message: string, context: Record<string, unknown>): void;
}

/**
 * List the hydrated, ordered, filtered tracks of a playlist (F5 — REQ-P-008).
 *
 * Composition:
 *  1. `repo.findById` → `NotFoundError` on null. OPEN READ — no ownership
 *     check (REQ-P-004).
 *  2. `repo.findOrderedTrackIds` (ordered by position asc).
 *  3. `catalog.findTrackByIds(allIds)` (cross-context, R-app-3 — order NOT
 *     guaranteed by the port contract).
 *  4. Silent-omit (LOCKED product #3 + design R7): unresolved ids are
 *     dropped from the result AND logged at warn level with the pinned shape
 *     `{ playlistId, omittedTrackIds[], count }`. Silent to the caller (no
 *     error envelope), observable to the operator.
 *  5. Iterate `rows` (NOT `found`) to drive hydration — preserves the per-
 *     position cardinality so repeatable tracks (LOCKED product #2) appear
 *     once per position. The defensive re-sort by position is implicit in
 *     the row-iteration order (rows already come ordered from the port).
 *
 * Framework-free by design: type-only import of the catalog port + entity.
 */
export class ListPlaylistTracksUseCase {
  constructor(
    private readonly playlists: PlaylistsRepositoryPort,
    private readonly catalog: CatalogRepositoryPort,
    private readonly logger: PlaylistLoggerPort,
  ) {}

  async execute(input: { id: string }): Promise<Track[]> {
    const playlist = await this.playlists.findById(input.id);
    if (!playlist) throw new NotFoundError('playlist', input.id);

    const rows = await this.playlists.findOrderedTrackIds(input.id);
    const trackIds = rows.map((r) => r.trackId);
    const found = await this.catalog.findTrackByIds(trackIds);
    const foundById = new Map(found.map((t) => [t.id, t]));

    // Silent-omit (LOCKED product #3 + design R7): warn on unresolved refs.
    const omittedTrackIds = trackIds.filter((id) => !foundById.has(id));
    if (omittedTrackIds.length > 0) {
      this.logger.warn('Playlist hydration omitted unresolved track references', {
        playlistId: input.id,
        omittedTrackIds,
        count: omittedTrackIds.length,
      });
    }

    // Iterate rows in port-guaranteed position order to preserve per-position
    // cardinality (repeatable tracks appear once per position) AND to re-sort
    // defensively against any catalog ordering drift (R-app-3).
    const hydrated: Track[] = [];
    for (const row of rows) {
      const track = foundById.get(row.trackId);
      if (track) hydrated.push(track);
    }
    return hydrated;
  }
}
