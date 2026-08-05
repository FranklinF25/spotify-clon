import { NotFoundError } from '../../../shared/errors/not-found-error';
import type { PlaylistsRepositoryPort } from '../domain/ports/playlists-repository.port';
import { loadOwnedPlaylist } from './load-owned-playlist.helper';

/**
 * Remove a track from a playlist (F5 — REQ-P-009 compact-on-remove).
 *
 * Composition: `loadOwnedPlaylist` (existence + ownership) → pre-check that
 * the `position` exists (avoid the "DELETE 0 rows is silent" trap) →
 * `repo.removeTrackAtPosition` (DELETE + UPDATE compact inside one
 * `$transaction`).
 *
 * Position pre-check: `findOrderedTrackIds` returns the rows ordered by
 * position asc; if `position < 1` or `position > maxPosition`, throw
 * `NotFoundError('playlist track', \`${playlistId}#${position}\`)` (REQ-P-009
 * scenario "Non-existent position returns 404"). The compact-on-remove
 * post-state is asserted at the integration layer (WORK-PR1-08).
 *
 * Framework-free by design.
 */
export class RemoveTrackFromPlaylistUseCase {
  constructor(private readonly playlists: PlaylistsRepositoryPort) {}

  async execute(input: {
    id: string;
    ownerId: string;
    position: number;
  }): Promise<void> {
    await loadOwnedPlaylist(input.id, input.ownerId, this.playlists);

    // Pre-check the position exists to surface a clean NotFoundError instead
    // of a silent 0-row DELETE. The compact-on-remove happens inside the
    // repo's transaction (DELETE + UPDATE trailing position-1).
    const rows = await this.playlists.findOrderedTrackIds(input.id);
    const maxPosition = rows.reduce((max, r) => Math.max(max, r.position), 0);
    if (input.position < 1 || input.position > maxPosition) {
      throw new NotFoundError('playlist track', `${input.id}#${input.position}`);
    }

    await this.playlists.removeTrackAtPosition({
      playlistId: input.id,
      position: input.position,
    });
  }
}
