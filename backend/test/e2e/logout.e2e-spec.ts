import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { bootAuthApp, type AuthE2eContext } from '../helpers/auth-e2e-app';

/**
 * Logout endpoint e2e (identity spec: "Logout").
 *
 * Uses a Supertest agent so the refresh cookie persists across the register →
 * logout calls. Scenarios: logout revokes the presented token (204 + cookie
 * cleared), logout is idempotent (calling twice still 204), and logout with no
 * cookie still returns 204.
 */
describe('POST /api/v1/auth/logout', () => {
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

  it('returns 204 and clears the refresh cookie', async () => {
    const agent = request.agent(ctx.app.getHttpServer());
    await agent
      .post('/api/v1/auth/register')
      .send({ email: 'alice@example.com', password: 'password123', displayName: 'Alice' });

    const res = await agent.post('/api/v1/auth/logout');

    expect(res.status).toBe(204);
    const setCookie = res.headers['set-cookie'];
    expect(setCookie).toBeDefined();
    const cookie = Array.isArray(setCookie) ? setCookie.join('; ') : String(setCookie);
    // Cleared: empty value and/or a past expiry.
    expect(cookie.toLowerCase()).toMatch(/refreshtoken=;|expires=thu, 01 jan 1970/);
  });

  it('is idempotent — a second logout without a valid cookie is still 204', async () => {
    const agent = request.agent(ctx.app.getHttpServer());
    await agent
      .post('/api/v1/auth/register')
      .send({ email: 'bob@example.com', password: 'password123', displayName: 'Bob' });

    const first = await agent.post('/api/v1/auth/logout');
    expect(first.status).toBe(204);

    const second = await agent.post('/api/v1/auth/logout');
    expect(second.status).toBe(204);
  });

  it('returns 204 even when no refresh cookie is present', async () => {
    const res = await request(ctx.app.getHttpServer()).post('/api/v1/auth/logout');

    expect(res.status).toBe(204);
  });
});
