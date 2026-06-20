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
 *   - `save(token)` is an upsert by id so `revoke()` mutations persist.
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
}
