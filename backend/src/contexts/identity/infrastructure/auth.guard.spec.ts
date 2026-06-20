import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import type { AccessTokenPayload } from '../domain/ports/jwt-signer.port';
import { UnauthorizedError } from '../../../shared/errors/unauthorized-error';
import { type RequestWithUser, JwtAuthGuard } from './auth.guard';
import { NestJwtSigner } from './nest-jwt-signer';

/**
 * JwtAuthGuard unit specs — pins the contract the /me route depends on: it
 * pulls the Bearer token off the Authorization header, delegates verification
 * to JwtSignerPort, stamps the claims on the request, and converts EVERY
 * failure path into the same `UnauthorizedError` so the response is a generic
 * 401 (spec: no user enumeration, "Missing access token" /
 * "Invalid or expired access token").
 *
 * Uses the real NestJwtSigner (no DB) so the guard↔signer integration is live.
 */
function makeContext(headers: Record<string, string>): ExecutionContext {
  const req = { headers } as RequestWithUser;
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as ExecutionContext;
}

function makeSigner() {
  return new NestJwtSigner({
    accessSecret: 'a'.repeat(48),
    refreshSecret: 'b'.repeat(48),
    accessTtl: '15m',
    refreshTtl: '7d',
    issuer: 'spotify-clon',
    audience: 'spotify-clon-users',
  });
}

describe('JwtAuthGuard', () => {
  const signer = makeSigner();
  const guard = new JwtAuthGuard(signer);

  it('authorizes a valid Bearer token and stamps the claims on the request', async () => {
    const token = await signer.signAccessToken({ sub: 'user-1', email: 'alice@example.com' });
    const ctx = makeContext({ authorization: `Bearer ${token}` });

    const ok = await guard.canActivate(ctx);

    expect(ok).toBe(true);
    const req = ctx.switchToHttp().getRequest<RequestWithUser>();
    expect(req.user).toMatchObject({ sub: 'user-1', email: 'alice@example.com' } satisfies AccessTokenPayload);
  });

  it('throws UnauthorizedError when the Authorization header is missing', async () => {
    await expect(guard.canActivate(makeContext({}))).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('throws UnauthorizedError for a non-Bearer scheme', async () => {
    await expect(
      guard.canActivate(makeContext({ authorization: 'Basic dXNlcjpwYXNz' })),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('throws UnauthorizedError for a malformed token', async () => {
    await expect(
      guard.canActivate(makeContext({ authorization: 'Bearer not.a.jwt' })),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('throws UnauthorizedError for a token signed with the wrong secret', async () => {
    const other = new NestJwtSigner({
      accessSecret: 'z'.repeat(48),
      refreshSecret: 'y'.repeat(48),
      accessTtl: '15m',
      refreshTtl: '7d',
      issuer: 'spotify-clon',
      audience: 'spotify-clon-users',
    });
    const token = await other.signAccessToken({ sub: 'u', email: 'x@y.z' });

    await expect(
      guard.canActivate(makeContext({ authorization: `Bearer ${token}` })),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });
});
