import { ConflictError } from '../../../shared/errors/conflict-error';
import type { JwtSignerPort } from '../domain/ports/jwt-signer.port';
import type { PasswordHasherPort } from '../domain/ports/password-hasher.port';
import type { RefreshTokenRepositoryPort } from '../domain/ports/refresh-token-repository.port';
import type { UserRepositoryPort } from '../domain/ports/user-repository.port';
import { RefreshToken } from '../domain/refresh-token.entity';
import { User } from '../domain/user.entity';

export interface RegisterInput {
  email: string;
  password: string;
  displayName: string;
}

export interface RegisterResult {
  accessToken: string;
  user: { id: string; email: string; displayName: string };
  refreshTokenValue: string;
}

export interface RegisterConfig {
  refreshTokenTtlMs: number;
}

/**
 * Register a new identity user, then immediately mint access + refresh
 * credentials so the client can authenticate without a second round trip
 * (spec: "Login works immediately after register").
 *
 * Sequence (DESIGN Register flow):
 *   1. existsByEmail(email) → ConflictError on duplicate,
 *   2. hash(password),
 *   3. User.register({...}) with a fresh uuid id,
 *   4. save(user),
 *   5. signRefreshToken({sub, jti, email}),
 *   6. RefreshToken.issue(...) + save,
 *   7. signAccessToken({sub, email}).
 *
 * The conflict short-circuits BEFORE hashing so we never pay the argon2 cost
 * on a guaranteed-failing request and never persist anything.
 */
export class RegisterUseCase {
  constructor(
    private readonly users: UserRepositoryPort,
    private readonly refreshTokens: RefreshTokenRepositoryPort,
    private readonly hasher: PasswordHasherPort,
    private readonly jwt: JwtSignerPort,
    private readonly config: RegisterConfig,
  ) {}

  async execute(input: RegisterInput): Promise<RegisterResult> {
    const email = input.email.trim().toLowerCase();

    const exists = await this.users.existsByEmail(email);
    if (exists) {
      throw new ConflictError('Email already registered');
    }

    const passwordHash = await this.hasher.hash(input.password);

    const userId = globalThis.crypto.randomUUID();
    const user = User.register({
      id: userId,
      email,
      passwordHash,
      displayName: input.displayName,
      now: new Date(),
    });
    await this.users.save(user);

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
