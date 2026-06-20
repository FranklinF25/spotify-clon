import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { bootAuthApp, E2E_REFRESH_SECRET, type AuthE2eContext } from '../helpers/auth-e2e-app';
import { NestJwtSigner } from '../../src/contexts/identity/infrastructure/nest-jwt-signer';

/**
 * GET /api/v1/me e2e (identity spec: "Current User Profile").
 *
 * Scenarios: authenticated request → 200 {id, email, displayName}; missing
 * Authorization header → 401; invalid/expired access token → 401.
 */
async function register(ctx: AuthE2eContext, email: string) {
  const res = await request(ctx.app.getHttpServer())
    .post('/api/v1/auth/register')
    .send({ email, password: 'password123', displayName: email.split('@')[0] });
  return res.body.accessToken as string;
}

describe('GET /api/v1/me', () => {
  let ctx: AuthE2eContext;

  beforeAll(async () => {
    ctx = await bootAuthApp();
  }, 90_000);
  afterAll(async () => {
    await ctx.cleanup();
  });
  beforeEach(async () => {
    await ctx.truncate();
  });

  it('returns 200 with the authenticated user profile', async () => {
    const accessToken = await register(ctx, 'alice@example.com');

    const res = await request(ctx.app.getHttpServer())
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: expect.any(String),
      email: 'alice@example.com',
      displayName: 'alice',
    });
    // passwordHash must never appear.
    expect(JSON.stringify(res.body)).not.toMatch(/hash/i);
  });

  it('returns 401 when the Authorization header is missing', async () => {
    const res = await request(ctx.app.getHttpServer()).get('/api/v1/me');

    expect(res.status).toBe(401);
    expect(res.body.error).toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('returns 401 for a malformed access token', async () => {
    const res = await request(ctx.app.getHttpServer())
      .get('/api/v1/me')
      .set('Authorization', 'Bearer not.a.valid.jwt');

    expect(res.status).toBe(401);
    expect(res.body.error).toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('returns 401 for an access token signed with the wrong secret', async () => {
    const attacker = new NestJwtSigner({
      accessSecret: 'z'.repeat(48),
      refreshSecret: E2E_REFRESH_SECRET,
      accessTtl: '15m',
      refreshTtl: '7d',
      issuer: 'spotify-clon',
      audience: 'spotify-clon-users',
    });
    const forged = await attacker.signAccessToken({ sub: 'x', email: 'x@y.z' });

    const res = await request(ctx.app.getHttpServer())
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${forged}`);

    expect(res.status).toBe(401);
  });
});
