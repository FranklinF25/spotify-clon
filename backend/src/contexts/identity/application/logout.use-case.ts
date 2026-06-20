import type {
  JwtSignerPort,
  RefreshTokenPayload,
} from '../domain/ports/jwt-signer.port';
import type { RefreshTokenRepositoryPort } from '../domain/ports/refresh-token-repository.port';

export interface LogoutInput {
  refreshTokenValue?: string;
}

/**
 * Revoke the presented refresh token in the database, if any.
 *
 * Idempotent (spec: "Logout is idempotent without a valid cookie") — every
 * non-happy path is a silent no-op so the controller can always answer 204:
 *   - no value supplied           → no-op,
 *   - JWT unverifiable / expired  → no-op,
 *   - jti unknown to the repo     → no-op,
 *   - token already revoked       → no-op (RefreshToken.revoke is idempotent
 *                                    and we skip the save when !isActive).
 *
 * Only the presented token is touched; other active tokens for the same user
 * stay active (spec: "Logout revokes only the presented token").
 */
export class LogoutUseCase {
  constructor(
    private readonly refreshTokens: RefreshTokenRepositoryPort,
    private readonly jwt: JwtSignerPort,
  ) {}

  async execute(input: LogoutInput): Promise<void> {
    if (!input.refreshTokenValue) {
      return;
    }

    let claims: RefreshTokenPayload;
    try {
      claims = await this.jwt.verifyRefreshToken(input.refreshTokenValue);
    } catch {
      return;
    }

    const rt = await this.refreshTokens.findByJti(claims.jti);
    if (!rt) {
      return;
    }
    if (!rt.isActive()) {
      return;
    }

    rt.revoke(new Date());
    await this.refreshTokens.save(rt);
  }
}
