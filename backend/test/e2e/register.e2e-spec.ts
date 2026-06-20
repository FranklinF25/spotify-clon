import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { bootAuthApp, type AuthE2eContext } from '../helpers/auth-e2e-app';

/**
 * Register endpoint e2e (identity spec: "User Registration").
 *
 * Real Postgres + real adapters. Scenarios: successful registration (201 +
 * accessToken + user + refresh cookie), duplicate email → 409 CONFLICT, short
 * password → 400 VALIDATION_ERROR with password detail, invalid email → 400
 * VALIDATION_ERROR with email detail, and login works immediately after
 * register.
 */
describe('POST /api/v1/auth/register', () => {
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

  it('returns 201 with { accessToken, user } and sets an httpOnly refresh cookie', async () => {
    const res = await request(ctx.app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: 'alice@example.com', password: 'password123', displayName: 'Alice' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      accessToken: expect.any(String),
      user: { id: expect.any(String), email: 'alice@example.com', displayName: 'Alice' },
    });
    // passwordHash must never leak into the response.
    expect(JSON.stringify(res.body)).not.toMatch(/hash/i);

    const setCookie = res.headers['set-cookie'];
    expect(setCookie).toBeDefined();
    const cookie = Array.isArray(setCookie) ? setCookie.join('; ') : String(setCookie);
    expect(cookie).toContain('refreshToken=');
    expect(cookie.toLowerCase()).toContain('httponly');
    expect(cookie.toLowerCase()).toContain('samesite=lax');
    expect(cookie.toLowerCase()).toContain('path=/api/v1/auth');
  });

  it('returns 409 CONFLICT when the email is already registered', async () => {
    await request(ctx.app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: 'dup@example.com', password: 'password123', displayName: 'Dup' });

    const res = await request(ctx.app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: 'dup@example.com', password: 'password123', displayName: 'Dup2' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'CONFLICT' });
    expect(JSON.stringify(res.body.error)).not.toMatch(/details/);
  });

  it('returns 400 VALIDATION_ERROR with a password detail when the password is too short', async () => {
    const res = await request(ctx.app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: 'short@example.com', password: '1234567', displayName: 'Short' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'password' })]),
    );
  });

  it('returns 400 VALIDATION_ERROR with an email detail when the email is malformed', async () => {
    const res = await request(ctx.app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: 'not-an-email', password: 'password123', displayName: 'Bad' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'email' })]),
    );
  });

  it('allows login immediately after a successful registration', async () => {
    await request(ctx.app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: 'immediate@example.com', password: 'password123', displayName: 'Immy' });

    const res = await request(ctx.app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'immediate@example.com', password: 'password123' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      accessToken: expect.any(String),
      user: { id: expect.any(String), email: 'immediate@example.com', displayName: 'Immy' },
    });
  });
});
