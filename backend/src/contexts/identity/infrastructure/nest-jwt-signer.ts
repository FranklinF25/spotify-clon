import { JwtService } from '@nestjs/jwt';
import type { StringValue } from 'ms';

import type {
  AccessTokenPayload,
  JwtSignerPort,
  RefreshTokenPayload,
} from '../domain/ports/jwt-signer.port';

/**
 * Configuration for {@link NestJwtSigner}. Secrets, TTLs, issuer and audience
 * all flow from the Zod-validated env config so the adapter itself stays free
 * of `process.env` reads. TTLs use the `ms` package's `StringValue`
 * (`'15m'`, `'7d'`, ...) which is exactly what `@nestjs/jwt`/jsonwebtoken accept.
 */
export interface NestJwtSignerConfig {
  /** Symmetric HS256 secret for access tokens (min 32 chars, enforced by config). */
  accessSecret: string;
  /** Separate symmetric HS256 secret for refresh tokens. */
  refreshSecret: string;
  /** Access TTL as an `ms` string, e.g. `15m`. */
  accessTtl: StringValue;
  /** Refresh TTL as an `ms` string, e.g. `7d`. */
  refreshTtl: StringValue;
  /** `iss` claim; verified on every token. */
  issuer: string;
  /** `aud` claim; verified on every token. */
  audience: string;
}

/**
 * JWT signing/verification adapter (HS256) backing `JwtSignerPort`.
 *
 * DESIGN JWT decisions:
 *   - algorithm HS256 (single backend signer),
 *   - separate secrets for access vs refresh,
 *   - issuer + audience pinned and checked on verify (defence-in-depth),
 *   - access TTL 15m, refresh TTL 7d.
 *
 * `algorithms: ['HS256']` is passed on every verify so a token crafted with a
 * different `alg` (e.g. `none`, or an HS256 forgery using a public key as the
 * secret) cannot bypass verification — the classic algorithm-confusion attack.
 *
 * A `JwtService` is owned internally rather than injected via DI so the adapter
 * is constructible and testable without a Nest `TestingModule`.
 */
export class NestJwtSigner implements JwtSignerPort {
  private readonly jwt: JwtService;

  constructor(private readonly config: NestJwtSignerConfig) {
    this.jwt = new JwtService();
  }

  signAccessToken(payload: AccessTokenPayload): Promise<string> {
    return this.jwt.signAsync(payload, {
      secret: this.config.accessSecret,
      expiresIn: this.config.accessTtl,
      issuer: this.config.issuer,
      audience: this.config.audience,
      algorithm: 'HS256',
    });
  }

  signRefreshToken(payload: RefreshTokenPayload): Promise<string> {
    return this.jwt.signAsync(payload, {
      secret: this.config.refreshSecret,
      expiresIn: this.config.refreshTtl,
      issuer: this.config.issuer,
      audience: this.config.audience,
      algorithm: 'HS256',
    });
  }

  verifyAccessToken(token: string): Promise<AccessTokenPayload> {
    return this.jwt.verifyAsync<AccessTokenPayload>(token, {
      secret: this.config.accessSecret,
      issuer: this.config.issuer,
      audience: this.config.audience,
      algorithms: ['HS256'],
    });
  }

  verifyRefreshToken(token: string): Promise<RefreshTokenPayload> {
    return this.jwt.verifyAsync<RefreshTokenPayload>(token, {
      secret: this.config.refreshSecret,
      issuer: this.config.issuer,
      audience: this.config.audience,
      algorithms: ['HS256'],
    });
  }
}
