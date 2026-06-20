import type { RefreshToken } from '../refresh-token.entity';

/**
 * Driven port (secondary) — abstracts persistence of `RefreshToken` rows.
 *
 * Implemented by `PrismaRefreshTokenRepository` in the infrastructure layer.
 *
 * Single-session + rotation semantics (DESIGN §1.4):
 *   - `findActiveByUser(userId)` returns rows where `revokedAt IS NULL AND
 *     expires_at > now`;
 *   - `revokeAllForUser(userId, exceptJti?)` is the single-session kill switch
 *     invoked by `LoginUseCase`;
 *   - `save(token)` is an upsert by id so `revoke()` mutations persist;
 *   - `revokeIfActive(jti, revokedAt)` performs a conditional UPDATE so the
 *     rotation step is atomic against concurrent refreshers (a returning
 *     `false` means "another caller revoked it first" → reuse detected);
 *   - `revokeAllAndSave(userId, newToken)` runs the single-session kill switch
 *     and the new-row insert inside a single transaction so a save failure
 *     never leaves the user with zero active tokens.
 */
export interface RefreshTokenRepositoryPort {
  findByJti(jti: string): Promise<RefreshToken | null>;
  findActiveByUser(userId: string): Promise<RefreshToken[]>;
  /** Insert or update (upsert by id). */
  save(token: RefreshToken): Promise<RefreshToken>;
  /** Sets `revokedAt = now` on the token and persists it. */
  revoke(token: RefreshToken): Promise<void>;
  /**
   * Revokes every active refresh token for `userId`. If `exceptJti` is given,
   * that jti is spared (used during rotation so the freshly issued row is not
   * immediately revoked).
   */
  revokeAllForUser(userId: string, exceptJti?: string): Promise<void>;
  /**
   * Atomically revoke the active row identified by `jti`.
   *
   * Returns `true` if a row was still active (`revokedAt IS NULL`) and got
   * stamped with `revokedAt`; returns `false` if no such row exists or it had
   * already been revoked. The conditional UPDATE is what defeats the
   * concurrent-rotation race (two refreshers presenting the same jti cannot
   * both pass).
   */
  revokeIfActive(jti: string, revokedAt: Date): Promise<boolean>;
  /**
   * Single-transaction single-session kill switch: revoke every active row for
   * `userId` and insert `newToken`. If the insert fails the revocations are
   * rolled back so the user is never left with zero active tokens.
   */
  revokeAllAndSave(userId: string, newToken: RefreshToken): Promise<void>;
}
