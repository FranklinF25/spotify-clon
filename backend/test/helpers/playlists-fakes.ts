import { randomUUID } from 'node:crypto';

import type {
  PlaylistRow,
  PlaylistTrackRow,
  PlaylistsRepositoryPort,
} from '../../src/contexts/playlists/domain/ports/playlists-repository.port';

/**
 * Hand-written in-memory fake for the playlists use-case specs (F5 — design
 * §14.2). Sibling of `catalog-fakes.ts`.
 *
 * Mirrors the catalog/identity fakes: implements the `PlaylistsRepositoryPort`
 * interface against `Map`s so the application layer stays framework-agnostic
 * and testable without Prisma or NestJS. Doubles as a LIVING CONSUMER of the
 * port — signature drift surfaces as a typecheck error here first.
 *
 * The transactional algorithms (compact-on-remove, reorder insert-and-shift,
 * addTrack max+1) are reimplemented in JS so the use cases can be tested
 * against the SAME contract the Prisma adapter honours. The integration spec
 * on the real adapter (unit 8) is the source of truth for SQL-level fidelity;
 * this fake is the source of truth for application-layer contract behaviour.
 *
 * R-app-5 failure-injection seam (load-bearing for the reorder-atomicity
 * integration test): the optional {@link reorderInjector} callback is invoked
 * AFTER the new ordering is computed but BEFORE it is committed to the in-
 * memory map. If the injector throws, the map is left EXACTLY as it was
 * before the call — the use case's contract "reorder is atomic" is therefore
 * testable without instrumenting the production Prisma adapter (which has no
 * such seam). The integration test asserts post-state equality against a pre-
 * reorder snapshot.
 */
export class InMemoryPlaylistsRepository implements PlaylistsRepositoryPort {
  private readonly playlists = new Map<string, PlaylistRow>();
  private readonly playlistTracks = new Map<string, PlaylistTrackRow[]>();

  /**
   * R-app-5 seam. Set from a spec to inject a synthetic failure between
   * "compute new ordering" and "commit to map". When the injector throws,
   * `reorder` propagates the throw and the map is unchanged.
   */
  public reorderInjector?: (playlistId: string) => Promise<void>;

  /** Snapshot the current playlist_tracks rows for a playlist (R-app-5 helper). */
  snapshotTracks(playlistId: string): PlaylistTrackRow[] {
    return (this.playlistTracks.get(playlistId) ?? []).map((r) =>
      Object.assign({}, r),
    );
  }

  /** Helper to seed the fake from a spec (push-through). */
  seed(input: {
    playlists?: PlaylistRow[];
    tracksByPlaylist?: Record<string, PlaylistTrackRow[]>;
  }): this {
    if (input.playlists) {
      for (const p of input.playlists) this.playlists.set(p.id, Object.assign({}, p));
    }
    if (input.tracksByPlaylist) {
      for (const [playlistId, rows] of Object.entries(input.tracksByPlaylist)) {
        this.playlistTracks.set(
          playlistId,
          rows.map((r) => Object.assign({}, r)),
        );
      }
    }
    return this;
  }

  async create(input: {
    userId: string;
    title: string;
    now: Date;
  }): Promise<PlaylistRow> {
    const row: PlaylistRow = {
      id: randomUUID(),
      userId: input.userId,
      title: input.title,
      createdAt: input.now,
      updatedAt: input.now,
    };
    this.playlists.set(row.id, { ...row });
    this.playlistTracks.set(row.id, []);
    return { ...row };
  }

  async findById(id: string): Promise<PlaylistRow | null> {
    const row = this.playlists.get(id);
    return row ? { ...row } : null;
  }

  async findByOwner(userId: string): Promise<PlaylistRow[]> {
    // newest first (REQ-P-003) — reverse-chronological on createdAt.
    return [...this.playlists.values()]
      .filter((p) => p.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((p) => Object.assign({}, p));
  }

  async updateTitle(id: string, title: string, now: Date): Promise<PlaylistRow | null> {
    const row = this.playlists.get(id);
    if (!row) return null;
    const updated: PlaylistRow = { ...row, title, updatedAt: now };
    this.playlists.set(id, updated);
    return { ...updated };
  }

  async delete(id: string): Promise<void> {
    this.playlists.delete(id);
    // FK CASCADE — playlist_tracks cleared in one statement (REQ-P-006).
    this.playlistTracks.delete(id);
  }

  async addTrack(input: {
    playlistId: string;
    trackId: string;
    now: Date;
  }): Promise<PlaylistTrackRow> {
    const rows = this.playlistTracks.get(input.playlistId) ?? [];
    const maxPos = rows.reduce((m, r) => Math.max(m, r.position), 0);
    const newRow: PlaylistTrackRow = {
      playlistId: input.playlistId,
      position: maxPos + 1,
      trackId: input.trackId,
      addedAt: input.now,
    };
    rows.push({ ...newRow });
    this.playlistTracks.set(input.playlistId, rows);
    return { ...newRow };
  }

  async removeTrackAtPosition(input: {
    playlistId: string;
    position: number;
  }): Promise<void> {
    const rows = this.playlistTracks.get(input.playlistId) ?? [];
    // compact-on-remove (REQ-P-009): drop the addressed row, then every row
    // above it decrements by 1 — positions stay dense 1..count.
    const next = rows
      .filter((r) => r.position !== input.position)
      .map((r) =>
        r.position > input.position ? { ...r, position: r.position - 1 } : { ...r },
      );
    this.playlistTracks.set(input.playlistId, next);
  }

  async reorder(input: {
    playlistId: string;
    from: number;
    to: number;
  }): Promise<PlaylistTrackRow[]> {
    const rows = this.playlistTracks.get(input.playlistId) ?? [];
    if (rows.length === 0) return [];

    // insert-and-shift (design §9.2): splice the moving row out, insert it
    // at the target slot, then reassign dense positions 1..N.
    const sorted = [...rows].sort((a, b) => a.position - b.position);
    const fromIdx = sorted.findIndex((r) => r.position === input.from);
    if (fromIdx === -1) {
      return sorted.map((r) => Object.assign({}, r));
    }
    const [moved] = sorted.splice(fromIdx, 1);
    const toIdx = input.to - 1; // positions are 1-indexed
    sorted.splice(toIdx, 0, moved);
    const newOrder = sorted.map((r, idx) =>
      Object.assign({}, r, { position: idx + 1 }),
    );

    // R-app-5 seam: invoke the injector AFTER computing but BEFORE committing.
    // If it throws, the map stays as-it-was (atomic).
    if (this.reorderInjector) {
      await this.reorderInjector(input.playlistId);
    }

    this.playlistTracks.set(input.playlistId, newOrder);
    return newOrder.map((r) => Object.assign({}, r));
  }

  async findOrderedTrackIds(playlistId: string): Promise<PlaylistTrackRow[]> {
    const rows = this.playlistTracks.get(playlistId) ?? [];
    return [...rows]
      .sort((a, b) => a.position - b.position)
      .map((r) => Object.assign({}, r));
  }
}

// ---------------------------------------------------------------------------
// Fixture builders — deterministic rows for use-case specs.
// ---------------------------------------------------------------------------

const EPOCH = new Date('2025-01-01T00:00:00.000Z');

export function buildPlaylist(
  overrides: Partial<PlaylistRow> = {},
): PlaylistRow {
  return {
    id: overrides.id ?? 'pl-1',
    userId: overrides.userId ?? 'user-1',
    title: overrides.title ?? 'My Playlist',
    createdAt: overrides.createdAt ?? EPOCH,
    updatedAt: overrides.updatedAt ?? EPOCH,
  };
}

export function buildPlaylistTrack(
  overrides: Partial<PlaylistTrackRow> = {},
): PlaylistTrackRow {
  return {
    playlistId: overrides.playlistId ?? 'pl-1',
    position: overrides.position ?? 1,
    trackId: overrides.trackId ?? 'track-1',
    addedAt: overrides.addedAt ?? EPOCH,
  };
}
