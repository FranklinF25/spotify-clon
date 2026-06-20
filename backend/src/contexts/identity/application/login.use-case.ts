import { UnauthorizedError } from '../../../shared/errors/unauthorized-error';
import type { JwtSignerPort } from '../domain/ports/jwt-signer.port';
import type { PasswordHasherPort } from '../domain/ports/password-hasher.port';
import type { RefreshTokenRepositoryPort } from '../domain/ports/refresh-token-repository.port';
import type { UserRepositoryPort } from '../domain/ports/user-repository.port';
import { RefreshToken } from '../domain/refresh-token.entity';

export interface LoginInput {
  email: string;
  password: string;
}

export interface LoginResult {
  accessToken: string;
  user: { id: string; email: string; displayName: string };
  refreshTokenValue: string;
}

export interface LoginConfig {
  refreshTokenTtlMs: number;
}

/**
 * Authenticate a user by email + password and issue new credentials.
 *
 * Sequence (DESIGN Login flow):
 *   1. user = findByEmail(email),
 *   2. if (!user) { hash(dummy); throw UnauthorizedError } — constant-time
 *      defence so a missed email takes roughly the same time as a wrong
 *      password (the argon2 hash dominates response time),
 *   3. ok = verify(password, user.passwordHash); if (!ok) throw Unauthorized,
 *   4. jti, signRefreshToken({sub, jti, email}),
 *   5. RefreshToken.issue({...}),
 *   6. revokeAllForUser(user.id) — single-session kill switch,
 *   7. save(refreshToken),
 *   8. signAccessToken({sub, email}).
 *
 * Auth failures never disclose which field was wrong (spec: no user
 * enumeration). Both error paths throw an identical `UnauthorizedError`.
 */
export class LoginUseCase {
  constructor(
    private readonly users: UserRepositoryPort,
    private readonly refreshTokens: RefreshTokenRepositoryPort,
    private readonly hasher: PasswordHasherPort,
    private readonly jwt: JwtSignerPort,
    private readonly config: LoginConfig,
  ) {}

  async execute(input: LoginInput): Promise<LoginResult> {
    const email = input.email.trim().toLowerCase();
    const user = await this.users.findByEmail(email);

    if (!user) {
      // Constant-time defence: hash anyway so timing matches the wrong-password
      // path (the hash dominates wall-clock; without this, unknown-email
      // responses would be visibly faster).
      await this.hasher.hash(input.password);
      throw new UnauthorizedError();
    }

    const ok = await this.hasher.verify(input.password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedError();
    }

    const jti = globalThis.crypto.randomUUID();
    const refreshTokenValue = await this.jwt.signRefreshToken({
      sub: user.id,
      jti,
      email: user.email,
    });
    const refreshToken = RefreshToken.issue({
      id: globalThis.crypto.randomUUID(),
      userId: user.id,
      jti,
      now: new Date(),
      ttlMs: this.config.refreshTokenTtlMs,
    });
    // Single-session: kill every previously active refresh token for this user
    // before issuing the new one so only the most recent session can refresh.
    await this.refreshTokens.revokeAllForUser(user.id);
    await this.refreshTokens.save(refreshToken);

    const accessToken = await this.jwt.signAccessToken({
      sub: user.id,
      email: user.email,
    });

    return {
      accessToken,
      user: user.toPrimitive(),
      refreshTokenValue,
    };
  }
}
