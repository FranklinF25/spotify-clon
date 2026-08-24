/**
 * Projection of one saved-album row (F6 — design §3). `userId` is OMITTED —
 * every consumer already knows which user it asked about (mirrors
 * `PlaylistTrackPrimitive` omitting `playlistId`).
 */
export interface UserLibraryAlbumPrimitive {
  albumId: string;
  addedAt: Date;
}

/**
 * Driven port (secondary) — abstracts persistence for the library bounded
 * context (F6 — design §3).
 *
 * NO rich entity exists (design D1 — DESIGN §2.3 "tabla de unión, no una
 * entidad"): the join row has no invariant beyond the composite key itself
 * (`userId` always comes from the JWT, never the payload), so the port
 * carries this minimal primitive instead.
 *
 * CROSS-CONTEXT CONTRACT — consumed by:
 *   - `library` use cases (this change)
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ EVOLUTION RULES                                                          │
 * ├──────────────────────────────────────────────────────────────────────────┤
 * │ • ADDITIVE evolution (NON-BREAKING): adding new methods to this port     │
 * │   does not break consumers.                                              │
 * │ • MUTATING evolution (BREAKING for every consumer): renaming or          │
 * │   re-typing any of the 3 methods below forces churn in every consumer.   │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Implementations:
 *   - `PrismaLibraryRepository` (infrastructure) — production + integration specs
 *   - `InMemoryLibraryRepository` (test/helpers/library-fakes.ts) —
 *     application-layer unit specs
 *
 * Framework-free by design: pure TS interface, zero NestJS / Prisma imports
 * (enforced by ESLint boundaries + the architecture portfolio test).
 */
export interface LibraryRepositoryPort {
  /**
   * UPSERT the (userId, albumId) row, always resetting `addedAt` to `now`
   * (LOCKED decision #3 — re-save moves the album to the top). Never throws
   * on duplicates; the composite PK makes the pair unique.
   */
  addAlbum(input: {
    userId: string;
    albumId: string;
    now: Date;
  }): Promise<UserLibraryAlbumPrimitive>;

  /**
   * Delete the caller's row. IDEMPOTENT: removing a pair that has no row
   * deletes 0 rows and returns void (REQ-L-004 — no 404, no 409).
   */
  removeAlbum(input: { userId: string; albumId: string }): Promise<void>;

  /**
   * The caller's saved rows ordered `added_at` DESC (most recent first,
   * LOCKED decision #3). Carries `addedAt` because the response projection
   * and the use case's defensive re-sort both need it.
   */
  listByUser(userId: string): Promise<UserLibraryAlbumPrimitive[]>;
}
