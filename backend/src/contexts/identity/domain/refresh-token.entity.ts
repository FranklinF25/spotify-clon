/**
 * Refresh token — persisted row backing a single JWT refresh credential.
 *
 * Lifecycle:
 *   issued (active) → revoked (by logout, rotation, or single-session kill)
 *                   OR expired (by time).
 *
 * `isActive()` is the conjunction of "not revoked yet" AND "not past
 * `expires_at`". The caller supplies the id / jti / now / ttl; this entity
 * only enforces invariants and owns the lifecycle transitions.
 *
 * Uses `globalThis.crypto.randomUUID()` (Web Crypto global) at the call site
 * rather than `node:crypto` to keep the domain layer free of `node:` built-ins
 * (DESIGN §3.4 rule 1).
 */
export class RefreshToken {
  private constructor(
    public readonly id: string,
    public readonly userId: string,
    public readonly jti: string,
    public readonly issuedAt: Date,
    public readonly expiresAt: Date,
    public revokedAt: Date | null,
    public readonly createdAt: Date,
  ) {}

  /**
   * Factory for a freshly issued refresh token.
   * Computes `expiresAt = now + ttlMs` and starts un-revoked.
   */
  static issue(input: {
    id: string;
    userId: string;
    jti: string;
    now: Date;
    ttlMs: number;
  }): RefreshToken {
    const expiresAt = new Date(input.now.getTime() + input.ttlMs);
    return new RefreshToken(
      input.id,
      input.userId,
      input.jti,
      input.now,
      expiresAt,
      null,
      input.now,
    );
  }

  /**
   * Reconstruct a `RefreshToken` straight from its persistence row.
   *
   * No re-validation: the row was written through {@link issue} + mutations
   * (`revoke`), and the persistence layer is trusted. `revokedAt` may be `null`
   * (active) or a past timestamp (revoked). Exists so the infrastructure layer
   * (PrismaRefreshTokenRepository) can hydrate aggregates without bypassing the
   * private constructor.
   */
  static reconstruct(input: {
    id: string;
    userId: string;
    jti: string;
    issuedAt: Date;
    expiresAt: Date;
    revokedAt: Date | null;
    createdAt: Date;
  }): RefreshToken {
    return new RefreshToken(
      input.id,
      input.userId,
      input.jti,
      input.issuedAt,
      input.expiresAt,
      input.revokedAt,
      input.createdAt,
    );
  }

  /**
   * Marks the token revoked at `now`. Idempotent — a second call is a no-op so
   * the original revocation timestamp is preserved (important for audit).
   */
  revoke(now: Date = new Date()): void {
    if (this.revokedAt === null) {
      this.revokedAt = now;
    }
  }

  /**
   * True once `revoke()` has been called at least once.
   *
   * Revocation is a state transition, not time-dependent: once `revokedAt` is
   * set the token is revoked forever (the only producer of `revokedAt` is
   * `revoke()`, which always uses a present-or-past timestamp). The DESIGN
   * draft's `revokedAt <= now` clause would let a token "un-revoke" when
   * queried at an earlier time, which contradicts the spec semantics —
   * simplified to a plain null-check.
   */
  isRevoked(): boolean {
    return this.revokedAt !== null;
  }

  /**
   * True once `now` has reached or passed `expiresAt` (inclusive — a token
   * presented at exactly its expiry second is no longer active).
   */
  isExpired(now: Date = new Date()): boolean {
    return now >= this.expiresAt;
  }

  /**
   * True iff the token may still be used to mint a new access token.
   */
  isActive(now: Date = new Date()): boolean {
    return !this.isRevoked() && !this.isExpired(now);
  }
}
