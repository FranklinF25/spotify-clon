import type { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { type LibraryE2eContext, libraryE2eApp } from '../helpers/library-e2e-app';

/**
 * End-to-end spec for the library HTTP API (F6 — WORK-PR2-03/04).
 *
 * Boots a real Postgres 16 container via testcontainers, registers real
 * identity users (U1, U2), signs real JWTs, seeds 4 catalog albums, and
 * stands up the full AppModule with LibraryModule wired.
 *
 * Covers every REQ-L-001..004 scenario from
 * `openspec/changes/library/specs/library/spec.md`. Each `it` name echoes
 * the scenario name from the spec so traceability is grep-able.
 *
 * Test isolation: `beforeEach` truncates ONLY `user_library_albums` (users +
 * catalog rows survive) so every `it` starts from a clean library slate
 * without paying the container/migration cost again.
 */
describe('Library HTTP API (e2e)', () => {
  let ctx: LibraryE2eContext;
  let prisma: PrismaClient;
  let A1: string;
  let A2: string;
  let A3: string;
  let A9: string;

  beforeAll(async () => {
    ctx = await libraryE2eApp();
    prisma = ctx.prisma;
    ({ A1, A2, A3, A9 } = ctx.albumIds);
  }, 120_000);

  afterAll(async () => {
    await ctx.cleanup();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "user_library_albums" CASCADE;');
  });

  // -------------------------------------------------------------------------
  // REQ-L-001 — Authentication on All Library Endpoints
  // -------------------------------------------------------------------------

  describe('REQ-L-001 — Authentication on all library endpoints', () => {
    it('Missing access token is rejected (401 UNAUTHORIZED)', async () => {
      const res = await request(ctx.app.getHttpServer()).get('/api/v1/library/albums');

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('Invalid or malformed bearer token is rejected (401 UNAUTHORIZED)', async () => {
      const res = await request(ctx.app.getHttpServer())
        .get('/api/v1/library/albums')
        .set('Authorization', 'Bearer not.a.valid.jwt');

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('Valid token reaches the handler (200 on the list op)', async () => {
      const res = await request(ctx.app.getHttpServer())
        .get('/api/v1/library/albums')
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // REQ-L-002 — Add Album to Library (Upsert, Always 204)
  // -------------------------------------------------------------------------

  describe('REQ-L-002 — Add album to library (upsert, always 204)', () => {
    it('First save returns 204 with no body AND the subsequent GET lists the album', async () => {
      const post = await request(ctx.app.getHttpServer())
        .post(`/api/v1/library/albums/${A1}`)
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`);

      expect(post.status).toBe(204);
      expect(post.body).toEqual({});

      const list = await request(ctx.app.getHttpServer())
        .get('/api/v1/library/albums')
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`);

      expect(list.status).toBe(200);
      expect(list.body).toHaveLength(1);
      expect(list.body[0].album.id).toBe(A1);
      expect(list.body[0].addedAt).toEqual(expect.any(String));
    });

    it('Re-saving an already-saved album returns 204 (never 409) AND moves it to the top', async () => {
      const u1 = ctx.tokens.U1.token;
      await request(ctx.app.getHttpServer())
        .post(`/api/v1/library/albums/${A1}`)
        .set('Authorization', `Bearer ${u1}`);
      await request(ctx.app.getHttpServer())
        .post(`/api/v1/library/albums/${A2}`)
        .set('Authorization', `Bearer ${u1}`);
      // Small stagger so added_at strictly increases (timestamptz precision).
      await new Promise((r) => setTimeout(r, 20));
      const reSave = await request(ctx.app.getHttpServer())
        .post(`/api/v1/library/albums/${A1}`)
        .set('Authorization', `Bearer ${u1}`);

      expect(reSave.status).toBe(204);

      const list = await request(ctx.app.getHttpServer())
        .get('/api/v1/library/albums')
        .set('Authorization', `Bearer ${u1}`);

      expect(list.status).toBe(200);
      expect(list.body.map((e: { album: { id: string } }) => e.album.id)).toEqual([A1, A2]);
    });

    it('Well-formed-but-unknown album UUID is rejected (422 UNPROCESSABLE_ENTITY) AND no row is written', async () => {
      const unknown = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
      const res = await request(ctx.app.getHttpServer())
        .post(`/api/v1/library/albums/${unknown}`)
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`);

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('UNPROCESSABLE_ENTITY');

      expect(await prisma.userLibraryAlbum.count()).toBe(0);
    });

    it('Malformed albumId param (not a UUID) is rejected (422 UNPROCESSABLE_ENTITY)', async () => {
      const res = await request(ctx.app.getHttpServer())
        .post('/api/v1/library/albums/not-a-uuid')
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`);

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('UNPROCESSABLE_ENTITY');
    });
  });

  // -------------------------------------------------------------------------
  // REQ-L-003 — List Saved Albums (Hydrated, Recency, Isolated)
  // -------------------------------------------------------------------------

  describe('REQ-L-003 — List saved albums (hydrated, recency, isolated)', () => {
    it('Returns hydrated albums most-recent-first when saved in order [A1, A2, A3]', async () => {
      const u1 = ctx.tokens.U1.token;
      for (const id of [A1, A2, A3]) {
        await request(ctx.app.getHttpServer())
          .post(`/api/v1/library/albums/${id}`)
          .set('Authorization', `Bearer ${u1}`);
        await new Promise((r) => setTimeout(r, 20));
      }

      const res = await request(ctx.app.getHttpServer())
        .get('/api/v1/library/albums')
        .set('Authorization', `Bearer ${u1}`);

      expect(res.status).toBe(200);
      expect(res.body.map((e: { album: { id: string } }) => e.album.id)).toEqual([A3, A2, A1]);
      // Hydrated projection: album nest carries the catalog summary fields.
      expect(res.body[0].album).toMatchObject({
        id: A3,
        title: 'Library Test Album A3',
        artist: { id: expect.any(String), name: 'Library Test Artist' },
      });
      expect(res.body[0].addedAt).toEqual(expect.any(String));
    });

    it("Another user's saves are invisible (user-scoped isolation)", async () => {
      await request(ctx.app.getHttpServer())
        .post(`/api/v1/library/albums/${A1}`)
        .set('Authorization', `Bearer ${ctx.tokens.U2.token}`);

      const u1List = await request(ctx.app.getHttpServer())
        .get('/api/v1/library/albums')
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`);

      expect(u1List.status).toBe(200);
      expect(u1List.body).toEqual([]);
    });

    it('A broken album reference is silently omitted (album deleted out-of-band → survivors only, no error)', async () => {
      const u1 = ctx.tokens.U1.token;
      for (const id of [A1, A2, A3]) {
        await request(ctx.app.getHttpServer())
          .post(`/api/v1/library/albums/${id}`)
          .set('Authorization', `Bearer ${u1}`);
        await new Promise((r) => setTimeout(r, 20));
      }
      // Out-of-band catalog delete — the junction row cascades away.
      await prisma.album.delete({ where: { id: A2 } });

      const res = await request(ctx.app.getHttpServer())
        .get('/api/v1/library/albums')
        .set('Authorization', `Bearer ${u1}`);

      expect(res.status).toBe(200);
      expect(res.body.map((e: { album: { id: string } }) => e.album.id)).toEqual([A3, A1]);

      // Restore the catalog row — albums survive beforeEach truncation, so
      // the out-of-band delete is otherwise permanent for this container
      // and pollutes every later save of A2.
      await prisma.$executeRawUnsafe(
        `INSERT INTO "albums" ("id", "title", "release_year", "cover_url", "artist_id")
         VALUES ('${A2}'::uuid, 'Library Test Album A2', 2002, NULL,
                 '00000000-0000-0000-0000-0000000000c1'::uuid)`,
      );
    });

    it('A user with no saves gets 200 and an empty array', async () => {
      const res = await request(ctx.app.getHttpServer())
        .get('/api/v1/library/albums')
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // REQ-L-004 — Remove Album from Library (Idempotent)
  // -------------------------------------------------------------------------

  describe('REQ-L-004 — Remove album from library (idempotent)', () => {
    it('Removing a saved album returns 204 AND the subsequent GET lists survivors only', async () => {
      const u1 = ctx.tokens.U1.token;
      await request(ctx.app.getHttpServer())
        .post(`/api/v1/library/albums/${A1}`)
        .set('Authorization', `Bearer ${u1}`);
      await request(ctx.app.getHttpServer())
        .post(`/api/v1/library/albums/${A2}`)
        .set('Authorization', `Bearer ${u1}`);

      const del = await request(ctx.app.getHttpServer())
        .delete(`/api/v1/library/albums/${A1}`)
        .set('Authorization', `Bearer ${u1}`);

      expect(del.status).toBe(204);
      expect(del.body).toEqual({});

      const list = await request(ctx.app.getHttpServer())
        .get('/api/v1/library/albums')
        .set('Authorization', `Bearer ${u1}`);

      expect(list.status).toBe(200);
      expect(list.body.map((e: { album: { id: string } }) => e.album.id)).toEqual([A2]);
    });

    it('Removing a never-saved but existing album returns 204 AND writes no row', async () => {
      const del = await request(ctx.app.getHttpServer())
        .delete(`/api/v1/library/albums/${A9}`)
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`);

      expect(del.status).toBe(204);
      expect(del.body).toEqual({});
      expect(await prisma.userLibraryAlbum.count()).toBe(0);
    });

    it("U1 removing a shared album leaves U2's save intact (cross-user isolation)", async () => {
      await request(ctx.app.getHttpServer())
        .post(`/api/v1/library/albums/${A1}`)
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`);
      await request(ctx.app.getHttpServer())
        .post(`/api/v1/library/albums/${A1}`)
        .set('Authorization', `Bearer ${ctx.tokens.U2.token}`);

      const del = await request(ctx.app.getHttpServer())
        .delete(`/api/v1/library/albums/${A1}`)
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`);

      expect(del.status).toBe(204);

      const u2List = await request(ctx.app.getHttpServer())
        .get('/api/v1/library/albums')
        .set('Authorization', `Bearer ${ctx.tokens.U2.token}`);

      expect(u2List.status).toBe(200);
      expect(u2List.body.map((e: { album: { id: string } }) => e.album.id)).toEqual([A1]);
    });
  });
});
