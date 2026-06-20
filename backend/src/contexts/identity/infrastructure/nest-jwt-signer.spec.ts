import { describe, expect, it } from 'vitest';

import type {
  AccessTokenPayload,
  RefreshTokenPayload,
} from '../domain/ports/jwt-signer.port';
import { NestJwtSigner } from './nest-jwt-signer';

/**
 * NestJwtSigner — adapter for `JwtSignerPort` backed by `@nestjs/jwt`.
 *
 * Pins the DESIGN JWT contract: HS256, separate access/refresh secrets, access
 * TTL 15m / refresh TTL 7d, and `issuer`/`audience` checked on verify. These are
 * real-library round-trip tests (no DB) that lock the verify-side guarantees the
 * use cases and AuthGuard rely on.
 */
function makeSigner(overrides: Partial<ConstructorParameters<typeof NestJwtSigner>[0]> = {}) {
  return new NestJwtSigner({
    accessSecret: 'a'.repeat(48),
    refreshSecret: 'b'.repeat(48),
    accessTtl: '15m',
    refreshTtl: '7d',
    issuer: 'spotify-clon',
    audience: 'spotify-clon-users',
    ...overrides,
  });
}

describe('NestJwtSigner', () => {
  describe('access token round-trip', () => {
    it('signs an access token that verifies back to the original claims', async () => {
      const signer = makeSigner();
      const payload: AccessTokenPayload = { sub: 'user-1', email: 'alice@example.com' };

      const token = await signer.signAccessToken(payload);
      const verified = await signer.verifyAccessToken(token);

      expect(verified.sub).toBe('user-1');
      expect(verified.email).toBe('alice@example.com');
    });

    it('emits a compact JWS header declaring HS256', async () => {
      const signer = makeSigner();
      const token = await signer.signAccessToken({ sub: 'u', email: 'x@y.z' });

      const header = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'));
      expect(header.alg).toBe('HS256');
    });
  });

  describe('refresh token round-trip', () => {
    it('signs a refresh token that verifies back to sub/jti/email', async () => {
      const signer = makeSigner();
      const payload: RefreshTokenPayload = {
        sub: 'user-2',
        jti: 'jti-abc',
        email: 'bob@example.com',
      };

      const token = await signer.signRefreshToken(payload);
      const verified = await signer.verifyRefreshToken(token);

      expect(verified).toMatchObject({ sub: 'user-2', jti: 'jti-abc', email: 'bob@example.com' });
    });
  });

  describe('secret separation', () => {
    it('rejects an access token verified with the refresh secret', async () => {
      const signer = makeSigner();
      const token = await signer.signAccessToken({ sub: 'u', email: 'x@y.z' });

      await expect(signer.verifyRefreshToken(token)).rejects.toThrow();
    });

    it('rejects a refresh token verified with the access secret', async () => {
      const signer = makeSigner();
      const token = await signer.signRefreshToken({ sub: 'u', jti: 'j', email: 'x@y.z' });

      await expect(signer.verifyAccessToken(token)).rejects.toThrow();
    });
  });

  describe('integrity', () => {
    it('rejects a tampered token (signature mismatch)', async () => {
      const signer = makeSigner();
      const token = await signer.signAccessToken({ sub: 'u', email: 'x@y.z' });

      const tampered = token.slice(0, -2) + 'AA';
      await expect(signer.verifyAccessToken(tampered)).rejects.toThrow();
    });

    it('rejects a token from a different issuer', async () => {
      const signerA = makeSigner({ issuer: 'spotify-clon' });
      const signerB = makeSigner({
        issuer: 'someone-else',
        accessSecret: 'a'.repeat(48),
      });
      const token = await signerB.signAccessToken({ sub: 'u', email: 'x@y.z' });

      await expect(signerA.verifyAccessToken(token)).rejects.toThrow();
    });

    it('rejects a token for a different audience', async () => {
      const signerA = makeSigner({ audience: 'spotify-clon-users' });
      const signerB = makeSigner({
        audience: 'other-audience',
        accessSecret: 'a'.repeat(48),
      });
      const token = await signerB.signAccessToken({ sub: 'u', email: 'x@y.z' });

      await expect(signerA.verifyAccessToken(token)).rejects.toThrow();
    });
  });

  describe('expiry', () => {
    it('rejects an expired refresh token (TTL honoured)', async () => {
      const signer = makeSigner({ refreshTtl: '1s' });
      const token = await signer.signRefreshToken({ sub: 'u', jti: 'j', email: 'x@y.z' });

      await new Promise((resolve) => setTimeout(resolve, 1100));
      await expect(signer.verifyRefreshToken(token)).rejects.toThrow();
    });
  });
});
