/**
 * Track domain entity (CAT-PR2a-04).
 *
 * Reconstruct-only (proposal Decision 5 + spec R7): private constructor,
 * static `reconstruct()` hydrates straight from a persistence row with NO
 * write-side invariants. The DB is the trusted source of truth.
 *
 * `filePath` is a public readonly field (the future `playback` context reads
 * it via `CatalogRepositoryPort.findTrackById`) but is deliberately OMITTED
 * from `toPrimitive()` — it is an internal storage detail that MUST NEVER
 * leak over HTTP (R4 + S4). `SearchResult.tracks` uses `TrackSummary` for the
 * same reason.
 *
 * Framework-free by design (DESIGN §Domain Layer).
 */
export class Track {
  private constructor(
    public readonly id: string,
    public readonly title: string,
    public readonly durationSeconds: number,
    public readonly filePath: string,
    public readonly trackNumber: number,
    public readonly albumId: string,
    public readonly createdAt: Date,
  ) {}

  /**
   * Hydrate a `Track` straight from a persistence row. NO invariants —
   * the row was written through the seed script, so re-checking would be
   * wasteful.
   */
  static reconstruct(input: {
    id: string;
    title: string;
    durationSeconds: number;
    filePath: string;
    trackNumber: number;
    albumId: string;
    createdAt: Date;
  }): Track {
    return new Track(
      input.id,
      input.title,
      input.durationSeconds,
      input.filePath,
      input.trackNumber,
      input.albumId,
      input.createdAt,
    );
  }

  /**
   * HTTP-facing projection. `filePath` is OMITTED (internal storage detail,
   * never leaks over HTTP — R4 guard). `createdAt` is omitted (internal).
   * The future `playback` context reads `filePath` directly off the entity
   * via the port — NOT through this projection.
   */
  toPrimitive(): {
    id: string;
    title: string;
    durationSeconds: number;
    trackNumber: number;
    albumId: string;
  } {
    return {
      id: this.id,
      title: this.title,
      durationSeconds: this.durationSeconds,
      trackNumber: this.trackNumber,
      albumId: this.albumId,
    };
  }
}
