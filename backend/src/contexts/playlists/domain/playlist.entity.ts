import { ForbiddenError } from '../../../shared/errors/forbidden-error';
import { ValidationError } from '../../../shared/errors/validation-error';

const TITLE_MAX = 100;

/**
 * Public projection of a {@link Playlist} aggregate (F5 — design §3.1).
 *
 * Hand-synced to the frontend `PlaylistPrimitive` (DESIGN §4.1 discipline).
 */
export interface PlaylistPrimitive {
  id: string;
  userId: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * `Playlist` aggregate — the portfolio's first user-owned write-side entity
 * (F5 — design §3.1).
 *
 * Owns three invariants:
 *  - `title` trims to 1..100 chars (LOCKED product #5 + design R5 — enforced
 *    in the validating factory AND in `rename`, NOT as a DB column CHECK);
 *  - ownership (`userId`) — exposed via {@link ensureOwnedBy} so mutation use
 *    cases can compose the ownership check after a load (LOCKED design R2);
 *  - timestamps (`createdAt` immutable, `updatedAt` bumped by `rename`).
 *
 * Mirrors identity's validating-factory + reconstruct split
 * (`backend/src/contexts/identity/domain/user.entity.ts`): `create` enforces
 * write-side invariants, `reconstruct` hydrates straight from a persistence
 * row WITHOUT re-checking (the row was written through the factory).
 *
 * Framework-free by design: only `./forbidden-error` + `./validation-error`
 * (both under `shared/errors`) imported — passes the architecture portfolio
 * test's domain framework-free rule.
 */
export class Playlist {
  private constructor(
    public readonly id: string,
    public readonly userId: string,
    private title: string,
    public readonly createdAt: Date,
    public updatedAt: Date,
  ) {}

  /**
   * Validating factory for a newly-created playlist. Trims `title` and throws
   * `ValidationError` (code `VALIDATION_ERROR`, HTTP 400) on 0 / >100 / non-
   * string title. Sets `createdAt = updatedAt = now`.
   */
  static create(input: {
    id: string;
    userId: string;
    title: string;
    now: Date;
  }): Playlist {
    if (typeof input.title !== 'string') {
      throw new ValidationError('Title must be between 1 and 100 characters', [
        { field: 'title', issue: 'invalid_type' },
      ]);
    }
    const title = input.title.trim();
    if (title.length < 1 || title.length > TITLE_MAX) {
      throw new ValidationError('Title must be between 1 and 100 characters', [
        { field: 'title', issue: 'invalid_length' },
      ]);
    }
    return new Playlist(input.id, input.userId, title, input.now, input.now);
  }

  /**
   * Rename the playlist. Reuses the create-time invariant and bumps
   * `updatedAt` to `now`. Throws `ValidationError` on the same title rules.
   */
  rename(newTitle: string, now: Date = new Date()): void {
    if (typeof newTitle !== 'string') {
      throw new ValidationError('Title must be between 1 and 100 characters', [
        { field: 'title', issue: 'invalid_type' },
      ]);
    }
    const trimmed = newTitle.trim();
    if (trimmed.length < 1 || trimmed.length > TITLE_MAX) {
      throw new ValidationError('Title must be between 1 and 100 characters', [
        { field: 'title', issue: 'invalid_length' },
      ]);
    }
    this.title = trimmed;
    this.updatedAt = now;
  }

  /**
   * Ownership invariant (REQ-P-011). Throws `ForbiddenError` (code `FORBIDDEN`,
   * HTTP 403) when `callerId` is not this playlist's owner.
   *
   * The invariant lives on the entity (the conceptual owner of "I belong to
   * userId X"); the composition (load → not-found → ownership check) lives in
   * the `loadOwnedPlaylist` application helper (design R2). `NotFoundError`
   * precedence over `ForbiddenError` is preserved by the helper, NOT here —
   * this method only answers "is this caller the owner?".
   */
  ensureOwnedBy(callerId: string): void {
    if (this.userId !== callerId) {
      throw new ForbiddenError('playlist', this.id);
    }
  }

  /**
   * Reconstruct a `Playlist` straight from its persistence row. NO
   * normalization, NO re-validation — the row was written through
   * {@link create}, so re-checking would be wasteful and would also reject
   * historically-stored values (mirrors `User.reconstruct`).
   */
  static reconstruct(input: PlaylistPrimitive): Playlist {
    return new Playlist(
      input.id,
      input.userId,
      input.title,
      input.createdAt,
      input.updatedAt,
    );
  }

  /** HTTP-facing projection. Drops nothing — all five fields are public. */
  toPrimitive(): PlaylistPrimitive {
    return {
      id: this.id,
      userId: this.userId,
      title: this.title,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}
