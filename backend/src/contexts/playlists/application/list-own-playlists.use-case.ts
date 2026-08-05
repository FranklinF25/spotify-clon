import type { PlaylistsRepositoryPort } from '../domain/ports/playlists-repository.port';

/**
 * Public projection for `GET /playlists` (F5 — REQ-P-003). The `userId`
 * field is implicit (the caller is always the owner), so it is omitted —
 * matches LOCKED design §8 `PlaylistSummary[]`.
 */
export interface PlaylistSummary {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * List the caller's own playlists, newest first (F5 — REQ-P-003).
 *
 * Read-only, owner-scoped at the SQL level (`WHERE user_id = $1` — the
 * repository never returns another user's row). Returns `PlaylistSummary[]`
 * with no `userId` field (implicit).
 *
 * Framework-free by design.
 */
export class ListOwnPlaylistsUseCase {
  constructor(private readonly playlists: PlaylistsRepositoryPort) {}

  async execute(input: { ownerId: string }): Promise<PlaylistSummary[]> {
    const rows = await this.playlists.findByOwner(input.ownerId);
    return rows.map(({ id, title, createdAt, updatedAt }) => ({
      id,
      title,
      createdAt,
      updatedAt,
    }));
  }
}
