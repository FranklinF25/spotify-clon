/**
 * Album domain entity (CAT-PR2a-03).
 *
 * Reconstruct-only (proposal Decision 5 + spec R7): private constructor,
 * static `reconstruct()` hydrates straight from a persistence row with NO
 * write-side invariants. The DB is the trusted source of truth.
 *
 * JD Round 4 lesson (R3-W3): the entity carries ONLY `artistId` — NOT an
 * embedded `artist` field. The artist summary is a read-model concern
 * (`AlbumSummary.artist`) built by the adapter, not domain state. Embedding
 * `artist` on the entity would couple the persistence shape to a projection.
 *
 * Framework-free by design (DESIGN §Domain Layer).
 */
export class Album {
  private constructor(
    public readonly id: string,
    public readonly title: string,
    public readonly releaseYear: number | null,
    public readonly coverUrl: string | null,
    public readonly artistId: string,
    public readonly createdAt: Date,
  ) {}

  /**
   * Hydrate an `Album` straight from a persistence row. NO invariants —
   * the row was written through the seed script, so re-checking would be
   * wasteful.
   */
  static reconstruct(input: {
    id: string;
    title: string;
    releaseYear: number | null;
    coverUrl: string | null;
    artistId: string;
    createdAt: Date;
  }): Album {
    return new Album(
      input.id,
      input.title,
      input.releaseYear,
      input.coverUrl,
      input.artistId,
      input.createdAt,
    );
  }

  /** HTTP-facing projection. Drops `createdAt`. Exposes `artistId` only. */
  toPrimitive(): {
    id: string;
    title: string;
    releaseYear: number | null;
    coverUrl: string | null;
    artistId: string;
  } {
    return {
      id: this.id,
      title: this.title,
      releaseYear: this.releaseYear,
      coverUrl: this.coverUrl,
      artistId: this.artistId,
    };
  }
}
