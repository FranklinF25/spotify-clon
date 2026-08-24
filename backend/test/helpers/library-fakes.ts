import type {
  LibraryRepositoryPort,
  UserLibraryAlbumPrimitive,
} from '../../src/contexts/library/domain/ports/library-repository.port';

/**
 * Hand-written in-memory fake for the library use-case specs (F6 — design
 * §11.1). Sibling of `catalog-fakes.ts` / `playlists-fakes.ts`.
 *
 * Implements the `LibraryRepositoryPort` interface against a Map keyed by
 * `${userId}:${albumId}` so the application layer stays framework-agnostic
 * and testable without Prisma or NestJS. Doubles as a LIVING CONSUMER of
 * the port — signature drift surfaces as a typecheck error here first.
 *
 * Semantics mirrored from the Prisma adapter (design §7):
 *  - `addAlbum` upserts and always resets `addedAt` to `input.now`;
 *  - `removeAlbum` deletes-if-present (no error on absent — REQ-L-004);
 *  - `listByUser` filters by userId, sorted `addedAt` desc (REQ-L-003).
 */
export class InMemoryLibraryRepository implements LibraryRepositoryPort {
  private readonly rows = new Map<string, UserLibraryAlbumPrimitive & { userId: string }>();

  /** Helper to seed the fake from a spec (push-through). */
  seed(input: {
    userId: string;
    rows: UserLibraryAlbumPrimitive[];
  }): this {
    for (const row of input.rows) {
      this.rows.set(`${input.userId}:${row.albumId}`, { userId: input.userId, ...row });
    }
    return this;
  }

  async addAlbum(input: {
    userId: string;
    albumId: string;
    now: Date;
  }): Promise<UserLibraryAlbumPrimitive> {
    const row = { userId: input.userId, albumId: input.albumId, addedAt: input.now };
    this.rows.set(`${input.userId}:${input.albumId}`, row);
    return { albumId: row.albumId, addedAt: row.addedAt };
  }

  async removeAlbum(input: { userId: string; albumId: string }): Promise<void> {
    this.rows.delete(`${input.userId}:${input.albumId}`);
  }

  async listByUser(userId: string): Promise<UserLibraryAlbumPrimitive[]> {
    return [...this.rows.values()]
      .filter((r) => r.userId === userId)
      .sort((a, b) => b.addedAt.getTime() - a.addedAt.getTime())
      .map((r) => ({ albumId: r.albumId, addedAt: r.addedAt }));
  }
}
