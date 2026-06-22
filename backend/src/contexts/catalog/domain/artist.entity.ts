/**
 * Artist domain entity (CAT-PR2a-02).
 *
 * Reconstruct-only — there is NO validating factory. The database is the
 * trusted source of truth for read-model hydration (proposal Decision 5 +
 * spec R7 "Reconstruct hydrates from a valid row"). Reconstruction is the
 * ONLY public construction path: the constructor is private so callers
 * cannot bypass the persistence-row contract.
 *
 * Two projections:
 *  - `toPrimitive()` — full HTTP-facing artist projection (no `createdAt`).
 *  - `toSummary()` — lean `{ id, name }` used by list endpoints and embedded
 *    inside `AlbumSummary.artist`.
 *
 * Framework-free by design (DESIGN §Domain Layer): zero NestJS / Prisma
 * imports, enforced by ESLint boundaries + the architecture portfolio test.
 */
export class Artist {
  private constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly bio: string | null,
    public readonly imageUrl: string | null,
    public readonly createdAt: Date,
  ) {}

  /**
   * Hydrate an `Artist` straight from a persistence row. NO invariants —
   * the row was written through the seed script, so re-checking would be
   * wasteful. The persistence layer is the trusted source of truth here.
   */
  static reconstruct(input: {
    id: string;
    name: string;
    bio: string | null;
    imageUrl: string | null;
    createdAt: Date;
  }): Artist {
    return new Artist(input.id, input.name, input.bio, input.imageUrl, input.createdAt);
  }

  /** Full HTTP-facing projection. Drops `createdAt` (internal). */
  toPrimitive(): { id: string; name: string; bio: string | null; imageUrl: string | null } {
    return { id: this.id, name: this.name, bio: this.bio, imageUrl: this.imageUrl };
  }

  /** Lean `{ id, name }` summary for list endpoints and nested embedding. */
  toSummary(): { id: string; name: string } {
    return { id: this.id, name: this.name };
  }
}
