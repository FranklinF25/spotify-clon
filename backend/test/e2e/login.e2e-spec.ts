import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { bootAuthApp, type AuthE2eContext } from '../helpers/auth-e2e-app';

/**
 * Login endpoint e2e (identity spec: "User Login").
 *
 * Scenarios: valid credentials → 200 + cookie; wrong password → 401
 * UNAUTHORIZED; unknown email → 401 UNAUTHORIZED indistinguishable from the
 * wrong-password case (no user enumeration); missing fields → 400.
 */
async function seedUser(ctx: AuthE2eContext, email: string, password = 'password123'): Promise<void> {
  await request(ctx.app.getHttpServer())
    .post('/api/v1/auth/register')
    .send({ email, password, displayName: email.split('@')[0] });
}

describe('POST /api/v1/auth/login', () => {
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

  it('returns 200 with { accessToken, user } and sets a refresh cookie on valid credentials', async () => {
    await seedUser(ctx, 'bob@example.com');

    const res = await request(ctx.app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'bob@example.com', password: 'password123' });

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email: 'bob@example.com' });
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.headers['set-cookie']).toBeDefined();
  });

  it('returns 401 UNAUTHORIZED (no detail) on a wrong password', async () => {
    await seedUser(ctx, 'carol@example.com');

    const res = await request(ctx.app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'carol@example.com', password: 'wrong-password' });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatchObject({ code: 'UNAUTHORIZED' });
    expect(JSON.stringify(res.body.error)).not.toMatch(/details/);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('returns an indistinguishable 401 for an unknown email', async () => {
    const res = await request(ctx.app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'ghost@example.com', password: 'whatever' });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('returns a 401 of the same shape for unknown-email vs wrong-password (no oracle)', async () => {
    await seedUser(ctx, 'dave@example.com');

    const wrongPassword = await request(ctx.app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'dave@example.com', password: 'nope-wrong' });

    const unknownEmail = await request(ctx.app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'missing@example.com', password: 'nope-wrong' });

    expect(wrongPassword.status).toBe(unknownEmail.status);
    expect(wrongPassword.body.error).toEqual(unknownEmail.body.error);
  });

  it('returns 400 VALIDATION_ERROR when fields are missing', async () => {
    const res = await request(ctx.app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'x@example.com' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
