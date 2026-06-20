/**
 * Access-token claims. `sub` is the userId; `email` is included so `/me` and
 * audit paths can read it without an extra DB lookup.
 */
export interface AccessTokenPayload {
  sub: string;
  email: string;
}

/**
 * Refresh-token claims. `jti` is the unique id of the persisted
 * `refresh_tokens` row (DESIGN §2.2) and is what the rotation/revocation
 * logic keys off.
 *
 * DESIGN open question (resolved): `email` is included here too so
 * `RefreshTokenUseCase` does not need a `findById` round-trip on every
 * `/auth/refresh`. Read-only, low-sensitivity.
 */
export interface RefreshTokenPayload {
  sub: string;
  jti: string;
  email: string;
}

/**
 * Driven port (secondary) — abstracts JWT signing and verification.
 *
 * Implemented by `NestJwtSigner` (HS256, separate access/refresh secrets,
 * issuer+audience pinned) in the infrastructure layer.
 *
 * DESIGN §3.2: pure TS interface under `domain/ports/`.
 */
export interface JwtSignerPort {
  signAccessToken(payload: AccessTokenPayload): Promise<string>;
  signRefreshToken(payload: RefreshTokenPayload): Promise<string>;
  verifyAccessToken(token: string): Promise<AccessTokenPayload>;
  verifyRefreshToken(token: string): Promise<RefreshTokenPayload>;
}
