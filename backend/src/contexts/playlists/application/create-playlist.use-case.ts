import { Playlist } from '../domain/playlist.entity';
import type { PlaylistPrimitive } from '../domain/playlist.entity';
import type { PlaylistsRepositoryPort } from '../domain/ports/playlists-repository.port';

/**
 * Create a new playlist owned by `ownerId` (F5 — REQ-P-002).
 *
 * Validates the title via `Playlist.create` (LOCKED product #5 — 1..100 chars
 * after trim; throws `ValidationError` otherwise). The id is server-generated
 * by the repository (Prisma `gen_random_uuid()`; `crypto.randomUUID()` in the
 * in-memory fake).
 *
 * Framework-free by design: only `domain/` + `shared/` imports.
 */
export class CreatePlaylistUseCase {
  constructor(private readonly playlists: PlaylistsRepositoryPort) {}

  async execute(input: {
    title: string;
    ownerId: string;
    now: Date;
  }): Promise<PlaylistPrimitive> {
    // The id is server-generated; pass a placeholder that the entity factory
    // ignores in favour of the repository's generated value.
    const playlist = Playlist.create({
      id: 'pending',
      userId: input.ownerId,
      title: input.title,
      now: input.now,
    });
    // Read the validated+trimmed title via the public projection (the field
    // itself is private — mutated only via create/rename).
    const validated = playlist.toPrimitive();
    const row = await this.playlists.create({
      userId: validated.userId,
      title: validated.title,
      now: input.now,
    });
    return Playlist.reconstruct(row).toPrimitive();
  }
}
