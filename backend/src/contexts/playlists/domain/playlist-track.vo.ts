/**
 * Public projection of a {@link PlaylistTrack} value object (F5 — design
 * §3.2).
 *
 * `playlistId` is OMITTED — the projection is consumed in contexts that
 * already know which playlist they asked about (mirrors `Album.toPrimitive`
 * dropping `createdAt`).
 */
export interface PlaylistTrackPrimitive {
  position: number;
  trackId: string;
  addedAt: Date;
}

/**
 * `PlaylistTrack` value object — the ordered membership row (F5 — design
 * §3.2).
 *
 * Identity is the composite `(playlistId, position)`; no lifecycle of its
 * own. Mutations happen only through the `Playlist` aggregate's use cases.
 *
 * Reconstruct-only: NO validating factory (rows always come from persistence
 * via repository methods that compute `position` deterministically, so
 * re-checking would be wasteful). Repeatable tracks (LOCKED product #2) fall
 * out naturally: two rows with the same `trackId` at different `position`s
 * are distinct under the composite PK.
 *
 * Framework-free by design.
 */
export class PlaylistTrack {
  private constructor(
    public readonly playlistId: string,
    public readonly position: number,
    public readonly trackId: string,
    public readonly addedAt: Date,
  ) {}

  /**
   * Reconstruct a `PlaylistTrack` straight from its persistence row. NO
   * invariants — the row's `position` was computed by the repository's
   * `addTrack` (max+1) or `reorder` (insert-and-shift), both inside
   * transactions, so the DB is the trusted source of truth.
   */
  static reconstruct(input: {
    playlistId: string;
    position: number;
    trackId: string;
    addedAt: Date;
  }): PlaylistTrack {
    return new PlaylistTrack(
      input.playlistId,
      input.position,
      input.trackId,
      input.addedAt,
    );
  }

  /**
   * HTTP-facing projection. Omits `playlistId` — the projection is consumed
   * by callers that already know which playlist they asked about.
   */
  toPrimitive(): PlaylistTrackPrimitive {
    return {
      position: this.position,
      trackId: this.trackId,
      addedAt: this.addedAt,
    };
  }
}
