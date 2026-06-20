import { NestJwtSigner } from '../../src/contexts/identity/infrastructure/nest-jwt-signer';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  bootAuthApp,
  E2E_ACCESS_SECRET,
  E2E_REFRESH_SECRET,
  type AuthE2eContext,
} from '../helpers/auth-e2e-app';

/**
 * Refresh endpoint e2e (identity spec: "Refresh Token Rotation" +
 * "Single-Session Refresh Tokens").
 *
 * Uses a Supertest agent so the refresh cookie set by login is carried into the
 * subsequent /auth/refresh call automatically. Scenarios: successful rotation
 * (new accessToken, presented row revoked, new cookie), a revoked refresh
 * rejected (401), missing cookie → 401, and an expired refresh JWT rejected.
 */
async function login(ctx: AuthE2eContext, email: string, password = 'password123') {
  const agent = request.agent(ctx.app.getHttpServer());
  await agent
    .post('/api/v1/auth/register')
    .send({ email, password, displayName: email.split('@')[0] });
  // login is implicit through register; agent already holds the refresh cookie.
  return agent;
}

describe('POST /api/v1/auth/refresh', () => {
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

  it('rotates: returns 200 with a new accessToken and sets a new refresh cookie', async () => {
    const agent = await login(ctx, 'alice@example.com');

    const res = await agent.post('/api/v1/auth/refresh');

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.headers['set-cookie']).toBeDefined();
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toContain('refreshToken=');
  });

  it('rejects a reused (already-rotated) refresh token with 401', async () => {
    const agent = await login(ctx, 'bob@example.com');

    const first = await agent.post('/api/v1/auth/refresh');
    expect(first.status).toBe(200);

    // The cookie that the FIRST refresh just rotated into is now the agent's
    // active cookie. Rotate once more so that the first-rotation cookie is
    // stale (its row was revoked by this second rotation).
    const rotatedOnce = extractRefreshCookie(first.headers['set-cookie']);
    await agent.post('/api/v1/auth/refresh');

    // Replay the stale cookie. IMPORTANT: the request is dispatched through a
    // one-shot `request(app)` rather than the supertest `agent` because the
    // agent's cookie jar would otherwise override any manual `Cookie` header
    // with the most recent cookie it holds (the still-active one), silently
    // turning this into a happy-path 200 instead of the expected 401. Using a
    // bare request guarantees the server sees exactly the cookie we set.
    const replay = await request(ctx.app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', `${rotatedOnce}`);

    expect(replay.status).toBe(401);
    expect(replay.body.error).toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('rejects a refresh token that a subsequent login revoked with 401', async () => {
    // Spec scenario "Revoked refresh token cannot be used": a refresh token
    // revoked by a second login (single-session semantics) must be rejected on
    // /auth/refresh. Triangulates the reuse rejection above by exercising the
    // revokeAllForUser path instead of the rotation path.
    const firstSession = await request(ctx.app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: 'carol@example.com', password: 'password123', displayName: 'carol' });
    const firstCookie = extractRefreshCookie(firstSession.headers['set-cookie']);

    // A second login for the same user revokes every prior active refresh row.
    await request(ctx.app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'carol@example.com', password: 'password123' });

    // Replay the cookie from the FIRST session. Same jar-override trap as
    // above — use a one-shot request so the cookie we set is exactly what the
    // server receives.
    const replay = await request(ctx.app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', `${firstCookie}`);

    expect(replay.status).toBe(401);
    expect(replay.body.error).toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('returns 401 when the refresh cookie is missing', async () => {
    const res = await request(ctx.app.getHttpServer()).post('/api/v1/auth/refresh');

    expect(res.status).toBe(401);
    expect(res.body.error).toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('returns 401 for a refresh JWT that has expired', async () => {
    // Sign a refresh token that expired ~1s ago using the app's refresh secret;
    // the use case verifies the JWT first and throws Unauthorized before any DB
    // lookup, so no matching row is needed.
    const expiredSigner = new NestJwtSigner({
      accessSecret: E2E_ACCESS_SECRET,
      refreshSecret: E2E_REFRESH_SECRET,
      accessTtl: '15m',
      refreshTtl: '1s',
      issuer: 'spotify-clon',
      audience: 'spotify-clon-users',
    });
    const expired = await expiredSigner.signRefreshToken({
      sub: '00000000-0000-0000-0000-000000000000',
      jti: 'expired-jti',
      email: 'x@example.com',
    });
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const res = await request(ctx.app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', `refreshToken=${expired}`);

    expect(res.status).toBe(401);
  });
});

function extractRefreshCookie(setCookie: unknown): string {
  const list = Array.isArray(setCookie) ? setCookie : [setCookie];
  const entry = String(list.find((c) => String(c).startsWith('refreshToken=')));
  // Trim attributes — only the name=value pair is needed for replay.
  return entry.split(';')[0];
}
