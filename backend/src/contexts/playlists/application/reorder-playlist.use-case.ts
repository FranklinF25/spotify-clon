import { UnprocessableEntityError } from '../../../shared/errors/unprocessable-entity-error';
import type { PlaylistTrackPrimitive } from '../domain/playlist-track.vo';
import type { PlaylistsRepositoryPort } from '../domain/ports/playlists-repository.port';
import { loadOwnedPlaylist } from './load-owned-playlist.helper';

/**
 * Reorder a track within a playlist (F5 — REQ-P-010 insert-and-shift).
 *
 * Composition: `loadOwnedPlaylist` (existence + ownership) → range-check
 * `1 ≤ from, to ≤ maxPosition` (else `UnprocessableEntityError('playlist
 * position', \`${from}→${to}\`)`) → `from === to` short-circuit no-op →
 * `repo.reorder` (single-statement UPDATE-CASE inside one `$transaction`,
 * DEFERRABLE PK from migration 0002 makes this safe).
 *
 * Range validation against `maxPosition` (a dynamic property the DTO cannot
 * know) is the use case's job — the DTO only checks `.int().positive()`.
 *
 * `from === to` short-circuits WITHOUT touching the DB (REQ-P-010 scenario
 * "No-op reorder is idempotent") — the use case still returns the current
 * ordering so the client gets a uniform response shape.
 *
 * Framework-free by design.
 */
export class ReorderPlaylistUseCase {
  constructor(private readonly playlists: PlaylistsRepositoryPort) {}

  async execute(input: {
    id: string;
    ownerId: string;
    from: number;
    to: number;
  }): Promise<PlaylistTrackPrimitive[]> {
    await loadOwnedPlaylist(input.id, input.ownerId, this.playlists);

    const rows = await this.playlists.findOrderedTrackIds(input.id);
    const maxPosition = rows.reduce((max, r) => Math.max(max, r.position), 0);

    // Dynamic range check (the DTO can only validate .int().positive() —
    // maxPosition is a runtime property of this playlist).
    if (
      input.from < 1 ||
      input.to < 1 ||
      input.from > maxPosition ||
      input.to > maxPosition
    ) {
      throw new UnprocessableEntityError(
        'playlist position',
        `${input.from}→${input.to}`,
      );
    }

    // No-op short-circuit BEFORE touching the DB (REQ-P-010 idempotent).
    if (input.from === input.to) {
      return rows.map((r) => ({
        position: r.position,
        trackId: r.trackId,
        addedAt: r.addedAt,
      }));
    }

    const reordered = await this.playlists.reorder({
      playlistId: input.id,
      from: input.from,
      to: input.to,
    });
    return reordered.map((r) => ({
      position: r.position,
      trackId: r.trackId,
      addedAt: r.addedAt,
    }));
  }
}
