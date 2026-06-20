import { UnauthorizedError } from '../../../shared/errors/unauthorized-error';
import type {
  JwtSignerPort,
  RefreshTokenPayload,
} from '../domain/ports/jwt-signer.port';
import type { RefreshTokenRepositoryPort } from '../domain/ports/refresh-token-repository.port';
import { RefreshToken } from '../domain/refresh-token.entity';

export interface RefreshTokenUseCaseInput {
  /**
   * Raw refresh JWT pulled from the cookie. `undefined` when the cookie is
   * missing — the controller passes the cookie straight through, so the type
   * mirrors that reality instead of pretending the value is always present.
   */
  refreshTokenValue: string | undefined;
}

export interface RefreshTokenUseCaseResult {
  accessToken: string;
  refreshTokenValue: string;
}

export interface RefreshTokenUseCaseConfig {
  refreshTokenTtlMs: number;
}

/**
 * Rotate a refresh token: validate the presented credential, revoke its row,
 * issue a new refresh token, and return a fresh access token.
 *
 * Sequence (DESIGN Refresh flow):
 *   1. if (!refreshTokenValue) throw Unauthorized  ◀── missing cookie short-circuit
 *   2. claims = verifyRefreshToken(value); throws ⇒ Unauthorized,
 *   3. rt = findByJti(claims.jti); null ⇒ Unauthorized,
 *   4. if (!rt.isActive()) throw Unauthorized,
 *   5. signRefreshToken({sub, jti: newJti, email}); RefreshToken.issue
 *                                                   ◀── build the replacement row
 *   6. ok = revokeIfActiveAndSave(claims.jti, now, newRt)  ◀── atomic rotation:
 *                                                          conditional revoke +
 *                                                          new-row insert in one
 *                                                          transaction,
 *      if (!ok) throw Unauthorized                          (lost the concurrent
 *                                                            race ⇒ reuse
 *                                                            detected, no insert),
 *   7. signAccessToken({sub, email}).
 *
 * Rotation always persists the audit trail: the presented row's `revokedAt`
 * is stamped via the conditional UPDATE inside the same transaction that
 * inserts a new row with a fresh jti. Reuse of a revoked jti is detected at
 * step 6 (the conditional UPDATE matches zero rows because `revokedAt IS NULL`
 * no longer holds) and rejected without inserting. The atomic
 * `revokeIfActiveAndSave` is what defeats BOTH the concurrent-rotation race
 * (two refreshers with the same cookie cannot both pass) AND the
 * partial-failure hole (if the insert fails the conditional revoke rolls
 * back so the user is never left with zero active tokens — the rotation
 * analogue of S4).
 *
 * `email` is read straight from the refresh claims (DESIGN open-question
 * resolution) so we avoid a `UserRepositoryPort.findById` round trip on every
 * refresh.
 */
export class RefreshTokenUseCase {
  constructor(
    private readonly refreshTokens: RefreshTokenRepositoryPort,
    private readonly jwt: JwtSignerPort,
    private readonly config: RefreshTokenUseCaseConfig,
  ) {}

  async execute(input: RefreshTokenUseCaseInput): Promise<RefreshTokenUseCaseResult> {
    if (!input.refreshTokenValue) {
      throw new UnauthorizedError();
    }

    let claims: RefreshTokenPayload;
    try {
      claims = await this.jwt.verifyRefreshToken(input.refreshTokenValue);
    } catch {
      throw new UnauthorizedError();
    }

    const rt = await this.refreshTokens.findByJti(claims.jti);
    if (!rt) {
      throw new UnauthorizedError();
    }
    // Pre-check covers the expired-and-then-reused path (cheap, read-only).
    // The atomic defence is the revokeIfActiveAndSave call below.
    if (!rt.isActive()) {
      throw new UnauthorizedError();
    }

    // Issue the new refresh token with a fresh jti BEFORE entering the atomic
    // step so the insert and the conditional revoke run inside a single tx.
    const newJti = globalThis.crypto.randomUUID();
    const newRefreshValue = await this.jwt.signRefreshToken({
      sub: rt.userId,
      jti: newJti,
      email: claims.email,
    });
    const newRt = RefreshToken.issue({
      id: globalThis.crypto.randomUUID(),
      userId: rt.userId,
      jti: newJti,
      now: new Date(),
      ttlMs: this.config.refreshTokenTtlMs,
    });

    // Atomic rotation: revoke the presented row iff still active AND insert
    // the replacement in one transaction. A `false` result means another
    // concurrent refresher revoked it first ⇒ treat as reuse and reject
    // without leaving a half-rotated state. A throw (e.g. unique violation on
    // the new jti) rolls back the conditional revoke so the user is never
    // left with zero active tokens.
    const revoked = await this.refreshTokens.revokeIfActiveAndSave(claims.jti, new Date(), newRt);
    if (!revoked) {
      throw new UnauthorizedError();
    }

    const accessToken = await this.jwt.signAccessToken({
      sub: rt.userId,
      email: claims.email,
    });

    return { accessToken, refreshTokenValue: newRefreshValue };
  }
}
