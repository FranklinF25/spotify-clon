/**
 * Public projection of a `Playlist` row, as persisted in `playlists` (F5 —
 * design §7). The repository returns this shape (NOT the entity) so callers
 * that need the entity reconstruct it via `Playlist.reconstruct(row)`.
 */
export interface PlaylistRow {
  id: string;
  userId: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Public projection of a `playlist_tracks` row (F5 — design §7).
 */
export interface PlaylistTrackRow {
  playlistId: string;
  position: number;
  trackId: string;
  addedAt: Date;
}

/**
 * Driven port (secondary) — abstracts persistence for the playlists bounded
 * context (F5 — design §7).
 *
 * CROSS-CONTEXT CONTRACT — consumed by:
 *   - `playlists` use cases (this change)
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ EVOLUTION RULES                                                          │
 * ├──────────────────────────────────────────────────────────────────────────┤
 * │ • ADDITIVE evolution (NON-BREAKING): adding new methods to this port     │
 * │   (e.g. a future `countTracksByPlaylist`) does NOT break consumers. New  │
 * │   methods may be added freely.                                           │
 * │ • MUTATING evolution (BREAKING for every consumer): renaming or          │
 * │   re-typing any of the 9 methods below forces churn in every consumer.   │
 * │   What stays locked is the signature of these 9 methods.                 │
 * │                                                                          │
 * │ Mutations that would force churn later (all BREAKING):                   │
 * │   - renaming any of the 9 locked methods;                                │
 * │   - changing return types (e.g. dropping `PlaylistTrackRow` for a        │
 * │     different projection);                                               │
 * │   - splitting the port into multiple smaller ports.                      │
 * │ None expected — the design is conservative on purpose.                   │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Transactional surface (LOCKED technical #9): `addTrack`,
 * `removeTrackAtPosition`, and `reorder` each internally wrap their writes in
 * a single `$transaction` (Prisma adapter) or the equivalent atomic batch
 * (in-memory fake). The application layer never sees the transaction
 * boundary — it just sees the method succeed or throw.
 *
 * Implementations:
 *   - `PrismaPlaylistsRepository` (infrastructure) — production + integration specs
 *   - `InMemoryPlaylistsRepository` (test/helpers/playlists-fakes.ts) —
 *     application-layer unit specs; ALSO doubles as the failure-injection
 *     seam for the reorder-atomicity integration test (R-app-5).
 *
 * Framework-free by design: pure TS interface, zero NestJS / Prisma imports
 * (enforced by ESLint boundaries + the architecture portfolio test).
 */
export interface PlaylistsRepositoryPort {
  /** Insert a new playlist row. The id is server-generated. */
  create(input: {
    userId: string;
    title: string;
    now: Date;
  }): Promise<PlaylistRow>;

  /** Find one playlist by id. Null when missing (open read — REQ-P-004). */
  findById(id: string): Promise<PlaylistRow | null>;

  /** List the caller's playlists, newest first (REQ-P-003). */
  findByOwner(userId: string): Promise<PlaylistRow[]>;

  /** Update title + bump updatedAt (REQ-P-005). */
  updateTitle(id: string, title: string, now: Date): Promise<PlaylistRow | null>;

  /** Hard delete (cascade clears playlist_tracks in one statement — REQ-P-006). */
  delete(id: string): Promise<void>;

  /**
   * Append a track at `max(position)+1` inside a transaction (REQ-P-007).
   * Returns the new row. Repeatable same-trackId twice → positions 1 then 2
   * (LOCKED product #2 — the composite PK makes them distinct).
   */
  addTrack(input: {
    playlistId: string;
    trackId: string;
    now: Date;
  }): Promise<PlaylistTrackRow>;

  /**
   * Delete the row at `position` + compact trailing rows by -1 inside one
   * transaction (REQ-P-009 compact-on-remove). The use case pre-checks that
   * `position` exists, so the repo contract is "best-effort delete" — if the
   * row is already gone (concurrent delete), 0 rows are removed and the
   * compact UPDATE is a no-op.
   */
  removeTrackAtPosition(input: {
    playlistId: string;
    position: number;
  }): Promise<void>;

  /**
   * Rewrite the ordering via single-statement UPDATE-CASE inside one
   * transaction (REQ-P-010). DEFERRABLE composite PK (declared in
   * migration 0002_playlists) makes the single-statement form safe. Returns
   * the new ordered rows. `from === to` is handled by the use case
   * (short-circuit no-op BEFORE calling the repo).
   */
  reorder(input: {
    playlistId: string;
    from: number;
    to: number;
  }): Promise<PlaylistTrackRow[]>;

  /** Ordered track rows for hydration (REQ-P-008). Ordered by position asc. */
  findOrderedTrackIds(playlistId: string): Promise<PlaylistTrackRow[]>;
}
