import type { CatalogRepositoryPort } from '../../catalog/domain/ports/catalog-repository.port';
import { UnprocessableEntityError } from '../../../shared/errors/unprocessable-entity-error';
import type { PlaylistTrackPrimitive } from '../domain/playlist-track.vo';
import type { PlaylistsRepositoryPort } from '../domain/ports/playlists-repository.port';
import { loadOwnedPlaylist } from './load-owned-playlist.helper';

/**
 * Append a track to a playlist (F5 — REQ-P-007).
 *
 * Composition: `loadOwnedPlaylist` (existence + ownership) → catalog
 * `findTrackByIds([trackId])` must return 1 row, else
 * `UnprocessableEntityError('track', trackId)` (LOCKED design R1 — the
 * trackId IS a valid UUID, it just does not resolve; semantic distinction
 * from 400 VALIDATION_ERROR) → `repo.addTrack` (computes `max(position)+1`
 * inside a transaction).
 *
 * Repeatable tracks (LOCKED product #2): the same trackId appended twice
 * lands at consecutive positions (1 then 2) — the composite PK makes them
 * distinct.
 *
 * Cross-context (R-app-3): consumes `CatalogRepositoryPort` via the symbol
 * token (resolved to `InMemoryCatalogRepository` here, `PrismaCatalogRepository`
 * in production via `CATALOG_REPOSITORY_PORT`). The cross-context ESLint rule
 * forbids importing the concrete adapter — only the port contract is allowed.
 *
 * Framework-free by design: only `domain/` + `shared/` + the catalog port
 * type-only import.
 */
export class AddTrackToPlaylistUseCase {
  constructor(
    private readonly playlists: PlaylistsRepositoryPort,
    private readonly catalog: CatalogRepositoryPort,
  ) {}

  async execute(input: {
    id: string;
    ownerId: string;
    trackId: string;
    now: Date;
  }): Promise<PlaylistTrackPrimitive> {
    // Ownership FIRST — never consult the catalog before the existence +
    // ownership checks pass (no information leakage to a non-owner; minimal
    // cross-context surface).
    await loadOwnedPlaylist(input.id, input.ownerId, this.playlists);

    const [found] = await this.catalog.findTrackByIds([input.trackId]);
    if (!found) {
      throw new UnprocessableEntityError('track', input.trackId);
    }

    const row = await this.playlists.addTrack({
      playlistId: input.id,
      trackId: input.trackId,
      now: input.now,
    });
    return {
      position: row.position,
      trackId: row.trackId,
      addedAt: row.addedAt,
    };
  }
}
