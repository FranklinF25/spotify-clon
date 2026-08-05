import { NotFoundError } from '../../../shared/errors/not-found-error';
import { Playlist } from '../domain/playlist.entity';
import type { PlaylistsRepositoryPort } from '../domain/ports/playlists-repository.port';

/**
 * Shared load + ownership helper for the five mutation use cases (F5 —
 * design §8).
 *
 * Composition: `findById → NotFoundError on null → ensureOwnedBy(callerId)
 * → return playlist`. `NotFoundError` precedence over `ForbiddenError` is
 * structural (REQ-P-011 scenario "Mutation on a missing playlist returns
 * 404, not 403"): the existence check runs FIRST, so a non-owner cannot
 * learn whether a UUID exists.
 *
 * The invariant lives on the entity (`Playlist.ensureOwnedBy`, LOCKED design
 * R2); this helper composes the load + the check so no single mutation use
 * case can forget it. NotFoundError precedence is also pinned here so the
 * controller cannot accidentally reverse it.
 *
 * Framework-free by design: only `domain/` + `shared/` imports.
 */
export async function loadOwnedPlaylist(
  playlistId: string,
  callerId: string,
  repo: PlaylistsRepositoryPort,
): Promise<Playlist> {
  const row = await repo.findById(playlistId);
  if (!row) {
    throw new NotFoundError('playlist', playlistId);
  }
  const playlist = Playlist.reconstruct(row);
  playlist.ensureOwnedBy(callerId);
  return playlist;
}
