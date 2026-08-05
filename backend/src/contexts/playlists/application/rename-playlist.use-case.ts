import { NotFoundError } from '../../../shared/errors/not-found-error';
import { Playlist } from '../domain/playlist.entity';
import type { PlaylistPrimitive } from '../domain/playlist.entity';
import type { PlaylistsRepositoryPort } from '../domain/ports/playlists-repository.port';
import { loadOwnedPlaylist } from './load-owned-playlist.helper';

/**
 * Rename a playlist (F5 — REQ-P-005).
 *
 * Composition: `loadOwnedPlaylist` (existence + ownership) → `rename` (same
 * 1..100 title invariant as `create`) → `repo.updateTitle`. Throws
 * `NotFoundError` (missing), `ForbiddenError` (non-owner), or
 * `ValidationError` (invalid title). NotFoundError precedence over
 * ForbiddenError is structural via the helper.
 *
 * Framework-free by design.
 */
export class RenamePlaylistUseCase {
  constructor(private readonly playlists: PlaylistsRepositoryPort) {}

  async execute(input: {
    id: string;
    ownerId: string;
    newTitle: string;
    now: Date;
  }): Promise<PlaylistPrimitive> {
    const playlist = await loadOwnedPlaylist(input.id, input.ownerId, this.playlists);
    playlist.rename(input.newTitle, input.now);
    // Read the validated+trimmed title via the public projection (the field
    // itself is private — mutated only via create/rename).
    const validated = playlist.toPrimitive();
    const row = await this.playlists.updateTitle(input.id, validated.title, input.now);
    if (!row) {
      // Defensive: the row vanished between load and update (concurrent
      // delete). Surface as NotFoundError so the contract stays uniform.
      throw new NotFoundError('playlist', input.id);
    }
    return Playlist.reconstruct(row).toPrimitive();
  }
}
