import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../../src/app.module';

/**
 * Foundation wiring smoke test (BF-12).
 *
 * Boots the real AppModule end-to-end and verifies the cross-cutting concerns
 * are wired: /health responds outside the versioned prefix, the request-id
 * middleware honors and generates ids, and the global exception filter shapes
 * unknown-route 404s into the DESIGN 4.3 envelope.
 */
function seedEnv(): void {
  process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/spotify_clone';
  process.env.JWT_ACCESS_SECRET = 'a'.repeat(48);
  process.env.JWT_REFRESH_SECRET = 'b'.repeat(48);
  // Required by AppConfig (PR-1 added AUDIO_STORAGE_PATH as a fail-fast
  // field). The foundation wiring smoke test does NOT exercise playback;
  // the placeholder is just enough to let AppConfig boot.
  process.env.AUDIO_STORAGE_PATH = '/tmp/playback-unused';
}

describe('AppModule foundation wiring', () => {
  let app: INestApplication;

  beforeAll(async () => {
    seedEnv();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['health'] });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves /health (outside the versioned prefix) with 200 ok', async () => {
    const res = await request(app.getHttpServer()).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('honors an incoming x-request-id and echoes it on the response', async () => {
    const res = await request(app.getHttpServer()).get('/health').set('x-request-id', 'r-smoke-1');

    expect(res.headers['x-request-id']).toBe('r-smoke-1');
  });

  it('generates a request id when the header is absent', async () => {
    const res = await request(app.getHttpServer()).get('/health');

    expect(String(res.headers['x-request-id'])).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('shapes an unknown route as the DESIGN 4.3 NOT_FOUND envelope', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/nope');

    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({ code: 'NOT_FOUND' });
  });
});
