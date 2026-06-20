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
 *   5. ok = revokeIfActive(claims.jti, now)        ◀── atomic rotation step 1
 *      if (!ok) throw Unauthorized                    (lost the concurrent race
 *                                                      ⇒ reuse detected),
 *   6. signRefreshToken({sub, jti: newJti, email}); RefreshToken.issue; save
 *                                                   ◀── rotation step 2: insert new
 *   7. signAccessToken({sub, email}).
 *
 * Rotation always persists the audit trail: the presented row's `revokedAt`
 * is stamped via the conditional `revokeIfActive` UPDATE, and a new row with
 * a fresh jti is inserted. Reuse of a revoked jti is detected at step 5
 * (the conditional UPDATE returns `false` because `revokedAt IS NULL` no
 * longer matches) and rejected. The atomic UPDATE is what defeats the race
 * where two concurrent refreshers with the same cookie would both otherwise
 * observe `isActive() === true` and both insert a new active row.
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
    // The atomic defence is the revokeIfActive call below.
    if (!rt.isActive()) {
      throw new UnauthorizedError();
    }

    // Rotation step 1 (atomic): revoke the presented row iff it is still
    // active. A `false` result means another concurrent refresher revoked it
    // first ⇒ treat as reuse and reject without issuing a new credential.
    const revoked = await this.refreshTokens.revokeIfActive(claims.jti, new Date());
    if (!revoked) {
      throw new UnauthorizedError();
    }

    // Rotation step 2: issue a new refresh token with a fresh jti.
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
    await this.refreshTokens.save(newRt);

    const accessToken = await this.jwt.signAccessToken({
      sub: rt.userId,
      email: claims.email,
    });

    return { accessToken, refreshTokenValue: newRefreshValue };
  }
}
