import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type PlaybackE2eContext,
  registerUser,
  startPlaybackE2E,
} from '../helpers/playback-e2e-app';

/**
 * End-to-end spec for `GET /api/v1/tracks/:id/stream` (PB-PR2-11,
 * REQ-PLAY-005 + REQ-PLAY-007).
 *
 * Boots a real Postgres 16 container via testcontainers, registers a real
 * identity user, signs a real JWT, seeds a single catalog track row whose
 * `filePath` resolves to the committed fixture mp3, and stands up the full
 * AppModule (PlaybackModule + AuthModule + CatalogModule + PrismaModule).
 *
 * Covers every status code the spec enumerates:
 *  - 200 full stream + Accept-Ranges + exact Content-Length
 *  - 206 partial stream + Content-Range + exact Content-Length (= end - start + 1)
 *  - 416 unsatisfiable Range + Content-Range bytes * slash total + empty body
 *  - 400 invalid Range syntax (bytes=abc)
 *  - 400 multi-range request (bytes=0-10,20-30)
 *  - 404 missing track
 *  - 401 missing / malformed JWT
 *
 * Additionally asserts that the stored `filePath` value NEVER leaks to the
 * client across ANY of the 7 scenarios (header, body, or status line).
 */
describe('GET /api/v1/tracks/:id/stream (playback e2e)', () => {
  let ctx: PlaybackE2eContext;
  let token: string;

  beforeAll(async () => {
    ctx = await startPlaybackE2E();
    token = await registerUser(ctx.app, 'playback-e2e@example.com');
  }, 120_000);

  afterAll(async () => {
    await ctx.cleanup();
  });

  // Helper: assert `filePath` never leaks in body or headers.
  function expectNoFilePathLeak(res: request.Response): void {
    const bodyStr = typeof res.body === 'string' ? res.body : JSON.stringify(res.body);
    const headerStr = JSON.stringify(res.headers);
    expect(bodyStr, `filePath leaked in body (status ${res.status})`).not.toContain(
      ctx.filePath,
    );
    expect(headerStr, `filePath leaked in headers (status ${res.status})`).not.toContain(
      ctx.filePath,
    );
  }

  describe('REQ-PLAY-005 — HTTP stream status code paths', () => {
    it('200 — no Range header: full stream + Accept-Ranges + exact Content-Length', async () => {
      const res = await request(ctx.app.getHttpServer())
        .get(`/api/v1/tracks/${ctx.trackId}/stream`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.headers['accept-ranges']).toBe('bytes');
      expect(res.headers['content-type']).toBe('audio/mpeg');
      // Exact Content-Length per W-content-length (asserts the helper's
      // computation matches the fixture's actual byte size).
      expect(Number(res.headers['content-length'])).toBe(ctx.trackSize);
      expect(res.body.length).toBe(ctx.trackSize);
      expectNoFilePathLeak(res);
    });

    it('206 — satisfiable Range: Content-Range + Content-Length = end - start + 1', async () => {
      const res = await request(ctx.app.getHttpServer())
        .get(`/api/v1/tracks/${ctx.trackId}/stream`)
        .set('Authorization', `Bearer ${token}`)
        .set('Range', 'bytes=0-1023');

      expect(res.status).toBe(206);
      expect(res.headers['accept-ranges']).toBe('bytes');
      expect(res.headers['content-type']).toBe('audio/mpeg');
      expect(res.headers['content-range']).toBe(`bytes 0-1023/${ctx.trackSize}`);
      // Content-Length = end - start + 1 = 1024 (RFC 7233 §4.2).
      expect(Number(res.headers['content-length'])).toBe(1024);
      expect(res.body.length).toBe(1024);
      expectNoFilePathLeak(res);
    });

    it('416 — unsatisfiable Range: Content-Range bytes * slash total + empty body', async () => {
      const res = await request(ctx.app.getHttpServer())
        .get(`/api/v1/tracks/${ctx.trackId}/stream`)
        .set('Authorization', `Bearer ${token}`)
        .set('Range', 'bytes=999999-');

      expect(res.status).toBe(416);
      expect(res.headers['content-range']).toBe(`bytes */${ctx.trackSize}`);
      // Empty body by design (Q5 — RFC 7233 §4.4).
      expect(res.body.length).toBe(0);
      expectNoFilePathLeak(res);
    });

    it('400 invalid — Range: bytes=abc: VALIDATION_ERROR envelope', async () => {
      const res = await request(ctx.app.getHttpServer())
        .get(`/api/v1/tracks/${ctx.trackId}/stream`)
        .set('Authorization', `Bearer ${token}`)
        .set('Range', 'bytes=abc');

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expectNoFilePathLeak(res);
    });

    it('400 multi-range — Range: bytes=0-10,20-30: VALIDATION_ERROR envelope', async () => {
      const res = await request(ctx.app.getHttpServer())
        .get(`/api/v1/tracks/${ctx.trackId}/stream`)
        .set('Authorization', `Bearer ${token}`)
        .set('Range', 'bytes=0-10,20-30');

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expectNoFilePathLeak(res);
    });

    it('404 — missing track: NOT_FOUND envelope', async () => {
      const res = await request(ctx.app.getHttpServer())
        .get('/api/v1/tracks/00000000-0000-0000-0000-000000000000/stream')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expectNoFilePathLeak(res);
    });

    it('401 — no Authorization header: UNAUTHORIZED envelope', async () => {
      const res = await request(ctx.app.getHttpServer()).get(
        `/api/v1/tracks/${ctx.trackId}/stream`,
      );

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
      expectNoFilePathLeak(res);
    });

    it('401 — malformed token: UNAUTHORIZED envelope', async () => {
      const res = await request(ctx.app.getHttpServer())
        .get(`/api/v1/tracks/${ctx.trackId}/stream`)
        .set('Authorization', 'Bearer not.a.valid.jwt');

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
      expectNoFilePathLeak(res);
    });
  });
});
