import type { PlaylistsRepositoryPort } from '../domain/ports/playlists-repository.port';
import { loadOwnedPlaylist } from './load-owned-playlist.helper';

/**
 * Hard-delete a playlist (F5 — REQ-P-006).
 *
 * Composition: `loadOwnedPlaylist` (existence + ownership) → `repo.delete`.
 * The FK CASCADE on `playlist_tracks.playlist_id` clears the junction rows
 * in one SQL statement (the actual cascade is asserted at the integration
 * layer in WORK-PR1-08). Returns void (HTTP 204).
 *
 * Throws `NotFoundError` (missing) or `ForbiddenError` (non-owner).
 *
 * Framework-free by design.
 */
export class DeletePlaylistUseCase {
  constructor(private readonly playlists: PlaylistsRepositoryPort) {}

  async execute(input: { id: string; ownerId: string }): Promise<void> {
    await loadOwnedPlaylist(input.id, input.ownerId, this.playlists);
    await this.playlists.delete(input.id);
  }
}
