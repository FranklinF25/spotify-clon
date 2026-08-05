import { NotFoundError } from '../../../shared/errors/not-found-error';
import { Playlist } from '../domain/playlist.entity';
import type { PlaylistPrimitive } from '../domain/playlist.entity';
import type { PlaylistsRepositoryPort } from '../domain/ports/playlists-repository.port';

/**
 * Get a single playlist by id (F5 — REQ-P-004 OPEN READ).
 *
 * Performs NO ownership check: any authenticated caller can read any
 * playlist. Ownership is enforced only on mutations (REQ-P-011). The use
 * case's signature carries NO `ownerId` parameter — this is the structural
 * guarantee that the open-read posture cannot regress.
 *
 * Throws `NotFoundError('playlist', id)` when missing.
 *
 * Framework-free by design.
 */
export class GetPlaylistUseCase {
  constructor(private readonly playlists: PlaylistsRepositoryPort) {}

  async execute(input: { id: string }): Promise<PlaylistPrimitive> {
    const row = await this.playlists.findById(input.id);
    if (!row) throw new NotFoundError('playlist', input.id);
    return Playlist.reconstruct(row).toPrimitive();
  }
}
