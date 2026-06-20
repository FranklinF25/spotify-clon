import { UnauthorizedError } from '../../../shared/errors/unauthorized-error';
import type {
  JwtSignerPort,
  RefreshTokenPayload,
} from '../domain/ports/jwt-signer.port';
import type { RefreshTokenRepositoryPort } from '../domain/ports/refresh-token-repository.port';
import { RefreshToken } from '../domain/refresh-token.entity';

export interface RefreshTokenUseCaseInput {
  refreshTokenValue: string;
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
 *   1. claims = verifyRefreshToken(value); throws ⇒ Unauthorized,
 *   2. rt = findByJti(claims.jti); null ⇒ Unauthorized,
 *   3. if (!rt.isActive()) throw Unauthorized,
 *   4. rt.revoke(now); save(rt)             ◀── rotation step 1: revoke presented
 *   5. signRefreshToken({sub, jti: newJti, email}); RefreshToken.issue; save
 *                                              ◀── rotation step 2: insert new
 *   6. signAccessToken({sub, email}).
 *
 * Rotation always persists the audit trail: the presented row's `revokedAt`
 * is set, and a new row with a fresh jti is inserted. Reuse of a revoked jti
 * is detected at step 3 (the row is no longer active) and rejected.
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
    if (!rt.isActive()) {
      throw new UnauthorizedError();
    }

    // Rotation step 1: revoke the presented row (persisted).
    rt.revoke(new Date());
    await this.refreshTokens.save(rt);

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
