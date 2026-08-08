import type { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  type PlaylistsE2eContext,
  registerUser,
  startPlaylistsE2E,
} from '../helpers/playlists-e2e-app';

/**
 * End-to-end spec for the playlists HTTP API (F5 — PR-2 WORK-PR2-03..05).
 *
 * Boots a real Postgres 16 container via testcontainers, registers real
 * identity users (U1, U2), signs real JWTs, seeds 4 catalog tracks, and
 * stands up the full AppModule with PlaylistsModule wired.
 *
 * Covers every REQ-P-001..011 scenario from
 * `openspec/changes/playlists/specs/playlists/spec.md`. Each `it` name
 * echoes the scenario name from the spec so traceability is grep-able.
 *
 * Test isolation: `beforeEach` truncates ONLY `playlist_tracks` + `playlists`
 * (users + catalog tracks survive) so every `it` starts from a clean
 * playlist slate without paying the container/migration cost again.
 * Playlists are created fresh inside each `it` via the HTTP API — tests never
 * share mutable state.
 */
describe('Playlists HTTP API (e2e)', () => {
  let ctx: PlaylistsE2eContext;
  let prisma: PrismaClient;
  /** The 4 seeded track UUIDs (`trackIds[0]` = T1, etc.). */
  let T1: string;
  let T2: string;
  let T3: string;
  let T4: string;

  beforeAll(async () => {
    ctx = await startPlaylistsE2E();
    prisma = ctx.prisma;
    [T1, T2, T3, T4] = ctx.trackIds;
  }, 120_000);

  afterAll(async () => {
    await ctx.cleanup();
  });

  // Reset playlist tables before each test so mutations from one `it` never
  // leak into the next. Users + catalog rows survive (only playlists junction
  // is cleared).
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "playlist_tracks", "playlists" RESTART IDENTITY CASCADE;',
    );
  });

  // ---------------------------------------------------------------------------
  // REQ-P-001 — Authentication on All Playlists Endpoints
  // ---------------------------------------------------------------------------

  describe('REQ-P-001 — Authentication on all endpoints', () => {
    it('Missing access token is rejected (401 UNAUTHORIZED)', async () => {
      const res = await request(ctx.app.getHttpServer()).get('/api/v1/playlists');

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('Invalid or expired access token is rejected (401 UNAUTHORIZED)', async () => {
      const res = await request(ctx.app.getHttpServer())
        .get('/api/v1/playlists')
        .set('Authorization', 'Bearer not.a.valid.jwt');

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('Valid token reaches the handler', async () => {
      const res = await request(ctx.app.getHttpServer())
        .get('/api/v1/playlists')
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // REQ-P-002 — Create Playlist
  // ---------------------------------------------------------------------------

  describe('REQ-P-002 — Create playlist', () => {
    it('Successful creation by an authenticated user (201 + PlaylistPrimitive)', async () => {
      const res = await request(ctx.app.getHttpServer())
        .post('/api/v1/playlists')
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`)
        .send({ title: 'My Mix' });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        title: 'My Mix',
        userId: ctx.tokens.U1.id,
      });
      expect(res.body.id).toEqual(expect.any(String));
      expect(res.body.createdAt).toEqual(expect.any(String));
      expect(res.body.updatedAt).toEqual(expect.any(String));
      // createdAt === updatedAt on a fresh create.
      expect(res.body.createdAt).toBe(res.body.updatedAt);
    });

    it('Empty title is rejected (400 VALIDATION_ERROR, details reference title)', async () => {
      const res = await request(ctx.app.getHttpServer())
        .post('/api/v1/playlists')
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`)
        .send({ title: '' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'title' })]),
      );
    });

    it('Title over 100 characters is rejected (400 VALIDATION_ERROR)', async () => {
      const res = await request(ctx.app.getHttpServer())
        .post('/api/v1/playlists')
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`)
        .send({ title: 'x'.repeat(101) });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'title' })]),
      );
    });

    it('Missing title is rejected (400 VALIDATION_ERROR)', async () => {
      const res = await request(ctx.app.getHttpServer())
        .post('/api/v1/playlists')
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'title' })]),
      );
    });

    it('Non-string title is rejected (400 VALIDATION_ERROR)', async () => {
      const res = await request(ctx.app.getHttpServer())
        .post('/api/v1/playlists')
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`)
        .send({ title: 42 });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'title' })]),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // REQ-P-003 — List Own Playlists
  // ---------------------------------------------------------------------------

  describe('REQ-P-003 — List own playlists', () => {
    it('Owner sees only their own playlists', async () => {
      // U1 creates P1 + P2; U2 creates P3.
      const p1 = await request(ctx.app.getHttpServer())
        .post('/api/v1/playlists')
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`)
        .send({ title: 'P1' });
      const p2 = await request(ctx.app.getHttpServer())
        .post('/api/v1/playlists')
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`)
        .send({ title: 'P2' });
      const p3 = await request(ctx.app.getHttpServer())
        .post('/api/v1/playlists')
        .set('Authorization', `Bearer ${ctx.tokens.U2.token}`)
        .send({ title: 'P3' });

      const res = await request(ctx.app.getHttpServer())
        .get('/api/v1/playlists')
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`);

      expect(res.status).toBe(200);
      // PlaylistSummary shape: { id, title, createdAt, updatedAt } — userId is
      // implicit (the caller is always the owner; LOCKED design §8).
      const ids = res.body.map((p: { id: string }) => p.id);
      expect(ids).toContain(p1.body.id);
      expect(ids).toContain(p2.body.id);
      // P3 (owned by U2) MUST NOT leak into U1's list (ownership scoping).
      expect(ids).not.toContain(p3.body.id);
    });

    it('Caller with no playlists receives an empty array', async () => {
      const U3 = await registerUser(ctx.app, 'playlists-u3-empty@example.com');

      const res = await request(ctx.app.getHttpServer())
        .get('/api/v1/playlists')
        .set('Authorization', `Bearer ${U3.token}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // REQ-P-004 — Get Playlist by Id (Open Read)
  // ---------------------------------------------------------------------------

  describe('REQ-P-004 — Get playlist by id (open read)', () => {
    it('Owner reads their own playlist (200)', async () => {
      const created = await request(ctx.app.getHttpServer())
        .post('/api/v1/playlists')
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`)
        .send({ title: 'Own' });

      const res = await request(ctx.app.getHttpServer())
        .get(`/api/v1/playlists/${created.body.id}`)
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(created.body.id);
      expect(res.body.userId).toBe(ctx.tokens.U1.id);
    });

    it('Non-owner can still read (open read posture — NOT 403)', async () => {
      const created = await request(ctx.app.getHttpServer())
        .post('/api/v1/playlists')
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`)
        .send({ title: 'Shared' });

      const res = await request(ctx.app.getHttpServer())
        .get(`/api/v1/playlists/${created.body.id}`)
        .set('Authorization', `Bearer ${ctx.tokens.U2.token}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(created.body.id);
    });

    it('Missing playlist returns 404 NOT_FOUND', async () => {
      const res = await request(ctx.app.getHttpServer())
        .get('/api/v1/playlists/00000000-0000-0000-0000-0000000000ff')
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  // ---------------------------------------------------------------------------
  // REQ-P-005 — Rename Playlist
  // ---------------------------------------------------------------------------

  describe('REQ-P-005 — Rename playlist', () => {
    it('Owner renames successfully (200, updatedAt advanced)', async () => {
      const created = await request(ctx.app.getHttpServer())
        .post('/api/v1/playlists')
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`)
        .send({ title: 'Old' });
      const createdAt = created.body.createdAt;

      // Wait so updatedAt advances measurably (timestamptz has microsecond
      // precision but the rename uses `now: new Date()` — a tiny delay
      // guarantees updatedAt > createdAt).
      await new Promise((r) => setTimeout(r, 20));

      const res = await request(ctx.app.getHttpServer())
        .patch(`/api/v1/playlists/${created.body.id}`)
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`)
        .send({ title: 'New' });

      expect(res.status).toBe(200);
      expect(res.body.title).toBe('New');
      expect(res.body.id).toBe(created.body.id);
      expect(res.body.userId).toBe(ctx.tokens.U1.id);
      expect(res.body.updatedAt).not.toBe(createdAt);
      expect(new Date(res.body.updatedAt).getTime()).toBeGreaterThan(
        new Date(createdAt).getTime(),
      );
    });

    it('Invalid title is rejected (400 VALIDATION_ERROR)', async () => {
      const created = await request(ctx.app.getHttpServer())
        .post('/api/v1/playlists')
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`)
        .send({ title: 'Original' });

      const res = await request(ctx.app.getHttpServer())
        .patch(`/api/v1/playlists/${created.body.id}`)
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`)
        .send({ title: '' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'title' })]),
      );
    });

    it('Missing playlist returns 404 NOT_FOUND', async () => {
      const res = await request(ctx.app.getHttpServer())
        .patch('/api/v1/playlists/00000000-0000-0000-0000-0000000000ff')
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`)
        .send({ title: 'New' });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('Non-owner rename is rejected with 403 FORBIDDEN', async () => {
      const created = await request(ctx.app.getHttpServer())
        .post('/api/v1/playlists')
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`)
        .send({ title: 'U1 Playlist' });

      const res = await request(ctx.app.getHttpServer())
        .patch(`/api/v1/playlists/${created.body.id}`)
        .set('Authorization', `Bearer ${ctx.tokens.U2.token}`)
        .send({ title: 'Hacked' });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  // ---------------------------------------------------------------------------
  // REQ-P-006 — Delete Playlist (Cascade)
  // ---------------------------------------------------------------------------

  describe('REQ-P-006 — Delete playlist (cascade)', () => {
    it('Owner deletes and the cascade clears playlist_tracks', async () => {
      const created = await request(ctx.app.getHttpServer())
        .post('/api/v1/playlists')
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`)
        .send({ title: 'ToDelete' });
      const playlistId = created.body.id;

      // Add 3 tracks so the cascade has rows to clear.
      for (const tid of [T1, T2, T3]) {
        await request(ctx.app.getHttpServer())
          .post(`/api/v1/playlists/${playlistId}/tracks`)
          .set('Authorization', `Bearer ${ctx.tokens.U1.token}`)
          .send({ trackId: tid });
      }
      // Confirm 3 rows exist before the delete.
      expect(await prisma.playlistTrack.count({ where: { playlistId } })).toBe(3);

      const res = await request(ctx.app.getHttpServer())
        .delete(`/api/v1/playlists/${playlistId}`)
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`);

      expect(res.status).toBe(204);
      expect(res.body).toEqual({});

      // Subsequent GET → 404.
      const getRes = await request(ctx.app.getHttpServer())
        .get(`/api/v1/playlists/${playlistId}`)
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`);
      expect(getRes.status).toBe(404);

      // Cascade verified at the row level — zero playlist_tracks remain.
      expect(await prisma.playlistTrack.count({ where: { playlistId } })).toBe(0);
    });

    it('Missing playlist returns 404 NOT_FOUND', async () => {
      const res = await request(ctx.app.getHttpServer())
        .delete('/api/v1/playlists/00000000-0000-0000-0000-0000000000ff')
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('Non-owner delete is rejected with 403 FORBIDDEN', async () => {
      const created = await request(ctx.app.getHttpServer())
        .post('/api/v1/playlists')
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`)
        .send({ title: 'U1 Playlist' });

      const res = await request(ctx.app.getHttpServer())
        .delete(`/api/v1/playlists/${created.body.id}`)
        .set('Authorization', `Bearer ${ctx.tokens.U2.token}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  // ---------------------------------------------------------------------------
  // REQ-P-007 — Add Track to Playlist
  // ---------------------------------------------------------------------------

  describe('REQ-P-007 — Add track to playlist', () => {
    it('Owner appends a track at the next position (201, position 2)', async () => {
      const created = await request(ctx.app.getHttpServer())
        .post('/api/v1/playlists')
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`)
        .send({ title: 'WithTracks' });

      // Seed first track at position 1.
      await request(ctx.app.getHttpServer())
        .post(`/api/v1/playlists/${created.body.id}/tracks`)
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`)
        .send({ trackId: T1 });

      // Append T2 at position 2.
      const res = await request(ctx.app.getHttpServer())
        .post(`/api/v1/playlists/${created.body.id}/tracks`)
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`)
        .send({ trackId: T2 });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        position: 2,
        trackId: T2,
        addedAt: expect.any(String),
      });
    });

    it('First track is appended at position 1 (201)', async () => {
      const created = await request(ctx.app.getHttpServer())
        .post('/api/v1/playlists')
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`)
        .send({ title: 'Empty' });

      const res = await request(ctx.app.getHttpServer())
        .post(`/api/v1/playlists/${created.body.id}/tracks`)
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`)
        .send({ trackId: T1 });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        position: 1,
        trackId: T1,
        addedAt: expect.any(String),
      });
    });

    it('Repeatable track — same trackId appended twice (positions 1 then 2)', async () => {
      const created = await request(ctx.app.getHttpServer())
        .post('/api/v1/playlists')
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`)
        .send({ title: 'Repeatable' });

      const first = await request(ctx.app.getHttpServer())
        .post(`/api/v1/playlists/${created.body.id}/tracks`)
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`)
        .send({ trackId: T1 });
      const second = await request(ctx.app.getHttpServer())
        .post(`/api/v1/playlists/${created.body.id}/tracks`)
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`)
        .send({ trackId: T1 });

      expect(first.status).toBe(201);
      expect(first.body.position).toBe(1);
      expect(second.status).toBe(201);
      expect(second.body.position).toBe(2);
    });

    it('Unknown trackId is rejected with 422 UNPROCESSABLE_ENTITY', async () => {
      const created = await request(ctx.app.getHttpServer())
        .post('/api/v1/playlists')
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`)
        .send({ title: 'UnknownTrack' });

      const res = await request(ctx.app.getHttpServer())
        .post(`/api/v1/playlists/${created.body.id}/tracks`)
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`)
        .send({ trackId: '00000000-0000-0000-0000-00000000dead' });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('UNPROCESSABLE_ENTITY');
    });

    it('Missing playlist returns 404 NOT_FOUND', async () => {
      const res = await request(ctx.app.getHttpServer())
        .post('/api/v1/playlists/00000000-0000-0000-0000-0000000000ff/tracks')
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`)
        .send({ trackId: T1 });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('Non-owner add track is rejected with 403 FORBIDDEN', async () => {
      const created = await request(ctx.app.getHttpServer())
        .post('/api/v1/playlists')
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`)
        .send({ title: 'U1 Playlist' });

      const res = await request(ctx.app.getHttpServer())
        .post(`/api/v1/playlists/${created.body.id}/tracks`)
        .set('Authorization', `Bearer ${ctx.tokens.U2.token}`)
        .send({ trackId: T1 });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  // ---------------------------------------------------------------------------
  // REQ-P-008 — List Playlist Tracks (Hydration + Silent Omit)
  // ---------------------------------------------------------------------------

  describe('REQ-P-008 — List playlist tracks (hydration + silent omit)', () => {
    it('Hydrated tracks are returned in position order', async () => {
      const created = await request(ctx.app.getHttpServer())
        .post('/api/v1/playlists')
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`)
        .send({ title: 'Ordered' });
      const playlistId = created.body.id;

      // Add in T1, T2, T3 order.
      for (const tid of [T1, T2, T3]) {
        await request(ctx.app.getHttpServer())
          .post(`/api/v1/playlists/${playlistId}/tracks`)
          .set('Authorization', `Bearer ${ctx.tokens.U1.token}`)
          .send({ trackId: tid });
      }

      const res = await request(ctx.app.getHttpServer())
        .get(`/api/v1/playlists/${playlistId}/tracks`)
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`);

      expect(res.status).toBe(200);
      expect(res.body.map((t: { id: string }) => t.id)).toEqual([T1, T2, T3]);
    });

    it('Empty playlist returns an empty array', async () => {
      const created = await request(ctx.app.getHttpServer())
        .post('/api/v1/playlists')
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`)
        .send({ title: 'Empty' });

      const res = await request(ctx.app.getHttpServer())
        .get(`/api/v1/playlists/${created.body.id}/tracks`)
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('Broken track reference is silently omitted, survivors re-sorted', async () => {
      const created = await request(ctx.app.getHttpServer())
        .post('/api/v1/playlists')
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`)
        .send({ title: 'BrokenRef' });
      const playlistId = created.body.id;

      // Add T1 at position 1 and T3 at position 3 normally. Position 2 is
      // inserted directly via prisma with a trackId NOT in tracks — the FK
      // constraint (ON DELETE RESTRICT) would reject this, so we bypass it
      // by temporarily setting session_replication_role to 'replica' (the
      // Postgres idiom for seeding inconsistent data in tests).
      await request(ctx.app.getHttpServer())
        .post(`/api/v1/playlists/${playlistId}/tracks`)
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`)
        .send({ trackId: T1 });
      await request(ctx.app.getHttpServer())
        .post(`/api/v1/playlists/${playlistId}/tracks`)
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`)
        .send({ trackId: T3 });

      // Insert a broken-ref row at position 2 (between T1@1 and T3@2→now 3).
      // After the HTTP add of T3 at position 2, positions are [T1=1, T3=2].
      // We want a broken ref at position 2 so T3 shifts to 3 — but the
      // add-track endpoint auto-assigns position. Instead, insert T3 first
      // (position 2), then raw-insert the broken ref at position 3, so
      // GET returns [T1, T3] with the broken pos-3 ref omitted.
      // Recompute: T1=1, T3=2, broken=3. GET should silently omit pos 3.
      const brokenTrackId = '00000000-0000-0000-0000-00000000dead';
      await prisma.$transaction([
        prisma.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'"),
        prisma.$executeRaw`INSERT INTO "playlist_tracks" ("playlist_id", "position", "track_id", "added_at")
          VALUES (${playlistId}::uuid, 3, ${brokenTrackId}::uuid, NOW())`,
      ]);

      const res = await request(ctx.app.getHttpServer())
        .get(`/api/v1/playlists/${playlistId}/tracks`)
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`);

      expect(res.status).toBe(200);
      // T1 at position 1, T3 at position 2; the broken position-3 ref is
      // silently omitted. Survivors stay in position order.
      expect(res.body.map((t: { id: string }) => t.id)).toEqual([T1, T3]);
    });

    it('Repeatable tracks appear once per position', async () => {
      const created = await request(ctx.app.getHttpServer())
        .post('/api/v1/playlists')
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`)
        .send({ title: 'Repeatable' });
      const playlistId = created.body.id;

      // T1, T2, T1 → positions 1, 2, 3.
      for (const tid of [T1, T2, T1]) {
        await request(ctx.app.getHttpServer())
          .post(`/api/v1/playlists/${playlistId}/tracks`)
          .set('Authorization', `Bearer ${ctx.tokens.U1.token}`)
          .send({ trackId: tid });
      }

      const res = await request(ctx.app.getHttpServer())
        .get(`/api/v1/playlists/${playlistId}/tracks`)
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`);

      expect(res.status).toBe(200);
      expect(res.body.map((t: { id: string }) => t.id)).toEqual([T1, T2, T1]);
    });

    it('Missing playlist returns 404 NOT_FOUND', async () => {
      const res = await request(ctx.app.getHttpServer())
        .get('/api/v1/playlists/00000000-0000-0000-0000-0000000000ff/tracks')
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  // ---------------------------------------------------------------------------
  // REQ-P-009 — Remove Track from Playlist (Compact-on-Remove)
  // ---------------------------------------------------------------------------

  describe('REQ-P-009 — Remove track (compact-on-remove)', () => {
    it('Middle removal compacts trailing positions', async () => {
      const created = await request(ctx.app.getHttpServer())
        .post('/api/v1/playlists')
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`)
        .send({ title: 'Compact' });
      const playlistId = created.body.id;

      for (const tid of [T1, T2, T3]) {
        await request(ctx.app.getHttpServer())
          .post(`/api/v1/playlists/${playlistId}/tracks`)
          .set('Authorization', `Bearer ${ctx.tokens.U1.token}`)
          .send({ trackId: tid });
      }

      // Delete the middle track (position 2 = T2).
      const res = await request(ctx.app.getHttpServer())
        .delete(`/api/v1/playlists/${playlistId}/tracks/2`)
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`);

      expect(res.status).toBe(204);

      // GET tracks → [T1, T3] (T3 shifted from position 3 to 2).
      const tracksRes = await request(ctx.app.getHttpServer())
        .get(`/api/v1/playlists/${playlistId}/tracks`)
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`);
      expect(tracksRes.body.map((t: { id: string }) => t.id)).toEqual([T1, T3]);

      // DB-level: positions stay dense (1, 2) — compact-on-remove invariant.
      const rows = await prisma.playlistTrack.findMany({
        where: { playlistId },
        orderBy: { position: 'asc' },
      });
      expect(rows.map((r) => r.position)).toEqual([1, 2]);
    });

    it('Last-position removal needs no shift', async () => {
      const created = await request(ctx.app.getHttpServer())
        .post('/api/v1/playlists')
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`)
        .send({ title: 'LastRemove' });
      const playlistId = created.body.id;

      for (const tid of [T1, T2, T3]) {
        await request(ctx.app.getHttpServer())
          .post(`/api/v1/playlists/${playlistId}/tracks`)
          .set('Authorization', `Bearer ${ctx.tokens.U1.token}`)
          .send({ trackId: tid });
      }

      const res = await request(ctx.app.getHttpServer())
        .delete(`/api/v1/playlists/${playlistId}/tracks/3`)
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`);

      expect(res.status).toBe(204);

      const tracksRes = await request(ctx.app.getHttpServer())
        .get(`/api/v1/playlists/${playlistId}/tracks`)
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`);
      expect(tracksRes.body.map((t: { id: string }) => t.id)).toEqual([T1, T2]);
    });

    it('Only-track removal leaves an empty but existing playlist', async () => {
      const created = await request(ctx.app.getHttpServer())
        .post('/api/v1/playlists')
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`)
        .send({ title: 'OnlyTrack' });
      const playlistId = created.body.id;

      await request(ctx.app.getHttpServer())
        .post(`/api/v1/playlists/${playlistId}/tracks`)
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`)
        .send({ trackId: T1 });

      const res = await request(ctx.app.getHttpServer())
        .delete(`/api/v1/playlists/${playlistId}/tracks/1`)
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`);

      expect(res.status).toBe(204);

      // GET tracks → [] (empty).
      const tracksRes = await request(ctx.app.getHttpServer())
        .get(`/api/v1/playlists/${playlistId}/tracks`)
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`);
      expect(tracksRes.status).toBe(200);
      expect(tracksRes.body).toEqual([]);

      // GET playlist → still 200 (playlist itself is not deleted).
      const playlistRes = await request(ctx.app.getHttpServer())
        .get(`/api/v1/playlists/${playlistId}`)
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`);
      expect(playlistRes.status).toBe(200);
    });

    it('Non-existent position returns 404 NOT_FOUND', async () => {
      const created = await request(ctx.app.getHttpServer())
        .post('/api/v1/playlists')
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`)
        .send({ title: 'NoPos' });
      const playlistId = created.body.id;

      for (const tid of [T1, T2, T3]) {
        await request(ctx.app.getHttpServer())
          .post(`/api/v1/playlists/${playlistId}/tracks`)
          .set('Authorization', `Bearer ${ctx.tokens.U1.token}`)
          .send({ trackId: tid });
      }

      const res = await request(ctx.app.getHttpServer())
        .delete(`/api/v1/playlists/${playlistId}/tracks/5`)
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');

      // No rows removed — positions stay 1, 2, 3.
      const count = await prisma.playlistTrack.count({ where: { playlistId } });
      expect(count).toBe(3);
    });

    it('Missing playlist returns 404 NOT_FOUND', async () => {
      const res = await request(ctx.app.getHttpServer())
        .delete('/api/v1/playlists/00000000-0000-0000-0000-0000000000ff/tracks/1')
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('Non-owner remove is rejected with 403 FORBIDDEN', async () => {
      const created = await request(ctx.app.getHttpServer())
        .post('/api/v1/playlists')
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`)
        .send({ title: 'U1 Tracks' });
      const playlistId = created.body.id;

      await request(ctx.app.getHttpServer())
        .post(`/api/v1/playlists/${playlistId}/tracks`)
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`)
        .send({ trackId: T1 });

      const res = await request(ctx.app.getHttpServer())
        .delete(`/api/v1/playlists/${playlistId}/tracks/1`)
        .set('Authorization', `Bearer ${ctx.tokens.U2.token}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  // ---------------------------------------------------------------------------
  // REQ-P-010 — Reorder Playlist Tracks ({ from, to })
  // ---------------------------------------------------------------------------

  describe('REQ-P-010 — Reorder playlist tracks', () => {
    it('Forward move shifts intermediate tracks up ([A,B,C,D] from=2 to=4 → [A,C,D,B])', async () => {
      const created = await request(ctx.app.getHttpServer())
        .post('/api/v1/playlists')
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`)
        .send({ title: 'ReorderFwd' });
      const playlistId = created.body.id;

      // [T1, T2, T3, T4] at positions 1..4.
      for (const tid of [T1, T2, T3, T4]) {
        await request(ctx.app.getHttpServer())
          .post(`/api/v1/playlists/${playlistId}/tracks`)
          .set('Authorization', `Bearer ${ctx.tokens.U1.token}`)
          .send({ trackId: tid });
      }

      const res = await request(ctx.app.getHttpServer())
        .post(`/api/v1/playlists/${playlistId}/reorder`)
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`)
        .send({ from: 2, to: 4 });

      expect(res.status).toBe(200);
      expect(res.body.map((r: { trackId: string }) => r.trackId)).toEqual([
        T1,
        T3,
        T4,
        T2,
      ]);
      // Positions stay dense (1..4).
      expect(res.body.map((r: { position: number }) => r.position)).toEqual([
        1,
        2,
        3,
        4,
      ]);

      // Cross-check via GET /tracks (hydrated render matches the lightweight
      // reorder response).
      const tracksRes = await request(ctx.app.getHttpServer())
        .get(`/api/v1/playlists/${playlistId}/tracks`)
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`);
      expect(tracksRes.body.map((t: { id: string }) => t.id)).toEqual([
        T1,
        T3,
        T4,
        T2,
      ]);
    });

    it('Backward move shifts intermediate tracks down ([A,B,C,D] from=4 to=1 → [D,A,B,C])', async () => {
      const created = await request(ctx.app.getHttpServer())
        .post('/api/v1/playlists')
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`)
        .send({ title: 'ReorderBwd' });
      const playlistId = created.body.id;

      for (const tid of [T1, T2, T3, T4]) {
        await request(ctx.app.getHttpServer())
          .post(`/api/v1/playlists/${playlistId}/tracks`)
          .set('Authorization', `Bearer ${ctx.tokens.U1.token}`)
          .send({ trackId: tid });
      }

      const res = await request(ctx.app.getHttpServer())
        .post(`/api/v1/playlists/${playlistId}/reorder`)
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`)
        .send({ from: 4, to: 1 });

      expect(res.status).toBe(200);
      expect(res.body.map((r: { trackId: string }) => r.trackId)).toEqual([
        T4,
        T1,
        T2,
        T3,
      ]);
    });

    it('No-op reorder is idempotent ([A,B,C] from=2 to=2 → [A,B,C])', async () => {
      const created = await request(ctx.app.getHttpServer())
        .post('/api/v1/playlists')
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`)
        .send({ title: 'ReorderNoop' });
      const playlistId = created.body.id;

      for (const tid of [T1, T2, T3]) {
        await request(ctx.app.getHttpServer())
          .post(`/api/v1/playlists/${playlistId}/tracks`)
          .set('Authorization', `Bearer ${ctx.tokens.U1.token}`)
          .send({ trackId: tid });
      }

      const res = await request(ctx.app.getHttpServer())
        .post(`/api/v1/playlists/${playlistId}/reorder`)
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`)
        .send({ from: 2, to: 2 });

      expect(res.status).toBe(200);
      expect(res.body.map((r: { trackId: string }) => r.trackId)).toEqual([
        T1,
        T2,
        T3,
      ]);
    });

    it('Out-of-range from=0 or to=99 is rejected with 422 UNPROCESSABLE_ENTITY', async () => {
      const created = await request(ctx.app.getHttpServer())
        .post('/api/v1/playlists')
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`)
        .send({ title: 'ReorderRange' });
      const playlistId = created.body.id;

      for (const tid of [T1, T2, T3]) {
        await request(ctx.app.getHttpServer())
          .post(`/api/v1/playlists/${playlistId}/tracks`)
          .set('Authorization', `Bearer ${ctx.tokens.U1.token}`)
          .send({ trackId: tid });
      }

      // from=0 — rejected by DTO .positive().
      const res1 = await request(ctx.app.getHttpServer())
        .post(`/api/v1/playlists/${playlistId}/reorder`)
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`)
        .send({ from: 0, to: 2 });
      expect(res1.status).toBe(422);
      expect(res1.body.error.code).toBe('UNPROCESSABLE_ENTITY');

      // to=99 — passes DTO but fails the use case's maxPosition check.
      const res2 = await request(ctx.app.getHttpServer())
        .post(`/api/v1/playlists/${playlistId}/reorder`)
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`)
        .send({ from: 2, to: 99 });
      expect(res2.status).toBe(422);
      expect(res2.body.error.code).toBe('UNPROCESSABLE_ENTITY');

      // Ordering unchanged after rejected reorders.
      const tracksRes = await request(ctx.app.getHttpServer())
        .get(`/api/v1/playlists/${playlistId}/tracks`)
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`);
      expect(tracksRes.body.map((t: { id: string }) => t.id)).toEqual([
        T1,
        T2,
        T3,
      ]);
    });

    it('Non-integer or missing from/to is rejected with 422 UNPROCESSABLE_ENTITY', async () => {
      const created = await request(ctx.app.getHttpServer())
        .post('/api/v1/playlists')
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`)
        .send({ title: 'ReorderBadShape' });
      const playlistId = created.body.id;

      // Non-integer from=1.5.
      const res1 = await request(ctx.app.getHttpServer())
        .post(`/api/v1/playlists/${playlistId}/reorder`)
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`)
        .send({ from: 1.5, to: 2 });
      expect(res1.status).toBe(422);
      expect(res1.body.error.code).toBe('UNPROCESSABLE_ENTITY');

      // Missing to.
      const res2 = await request(ctx.app.getHttpServer())
        .post(`/api/v1/playlists/${playlistId}/reorder`)
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`)
        .send({ from: 1 });
      expect(res2.status).toBe(422);
      expect(res2.body.error.code).toBe('UNPROCESSABLE_ENTITY');

      // Empty body.
      const res3 = await request(ctx.app.getHttpServer())
        .post(`/api/v1/playlists/${playlistId}/reorder`)
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`)
        .send({});
      expect(res3.status).toBe(422);
      expect(res3.body.error.code).toBe('UNPROCESSABLE_ENTITY');
    });
  });

  // ---------------------------------------------------------------------------
  // REQ-P-011 — Ownership Invariant & ForbiddenError
  // ---------------------------------------------------------------------------

  describe('REQ-P-011 — Ownership invariant & ForbiddenError', () => {
    it('Non-owner PATCH /:id is rejected with 403 FORBIDDEN AND no write occurred', async () => {
      const created = await request(ctx.app.getHttpServer())
        .post('/api/v1/playlists')
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`)
        .send({ title: 'Original Title' });
      const playlistId = created.body.id;

      const res = await request(ctx.app.getHttpServer())
        .patch(`/api/v1/playlists/${playlistId}`)
        .set('Authorization', `Bearer ${ctx.tokens.U2.token}`)
        .send({ title: 'Hacked' });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');

      // No write — title unchanged.
      const row = await prisma.playlist.findUnique({ where: { id: playlistId } });
      expect(row?.title).toBe('Original Title');
    });

    it('Non-owner DELETE /:id is rejected with 403 FORBIDDEN AND no write occurred', async () => {
      const created = await request(ctx.app.getHttpServer())
        .post('/api/v1/playlists')
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`)
        .send({ title: 'Protected' });
      const playlistId = created.body.id;

      const res = await request(ctx.app.getHttpServer())
        .delete(`/api/v1/playlists/${playlistId}`)
        .set('Authorization', `Bearer ${ctx.tokens.U2.token}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');

      // No write — playlist still exists.
      expect(await prisma.playlist.count({ where: { id: playlistId } })).toBe(1);
    });

    it('Non-owner POST /:id/tracks is rejected with 403 FORBIDDEN AND no write occurred', async () => {
      const created = await request(ctx.app.getHttpServer())
        .post('/api/v1/playlists')
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`)
        .send({ title: 'ProtectedTracks' });
      const playlistId = created.body.id;

      const res = await request(ctx.app.getHttpServer())
        .post(`/api/v1/playlists/${playlistId}/tracks`)
        .set('Authorization', `Bearer ${ctx.tokens.U2.token}`)
        .send({ trackId: T1 });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');

      // No write — zero playlist_tracks rows.
      expect(await prisma.playlistTrack.count({ where: { playlistId } })).toBe(0);
    });

    it('Non-owner DELETE /:id/tracks/:position is rejected with 403 FORBIDDEN AND no write occurred', async () => {
      const created = await request(ctx.app.getHttpServer())
        .post('/api/v1/playlists')
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`)
        .send({ title: 'ProtectedRemove' });
      const playlistId = created.body.id;

      // Seed one track.
      await request(ctx.app.getHttpServer())
        .post(`/api/v1/playlists/${playlistId}/tracks`)
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`)
        .send({ trackId: T1 });

      const res = await request(ctx.app.getHttpServer())
        .delete(`/api/v1/playlists/${playlistId}/tracks/1`)
        .set('Authorization', `Bearer ${ctx.tokens.U2.token}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');

      // No write — one row still present.
      expect(await prisma.playlistTrack.count({ where: { playlistId } })).toBe(1);
    });

    it('Non-owner POST /:id/reorder is rejected with 403 FORBIDDEN AND no write occurred', async () => {
      const created = await request(ctx.app.getHttpServer())
        .post('/api/v1/playlists')
        .set('Authorization', `Bearer ${ctx.tokens.U1.token}`)
        .send({ title: 'ProtectedReorder' });
      const playlistId = created.body.id;

      // Seed T1 at pos 1, T2 at pos 2.
      for (const tid of [T1, T2]) {
        await request(ctx.app.getHttpServer())
          .post(`/api/v1/playlists/${playlistId}/tracks`)
          .set('Authorization', `Bearer ${ctx.tokens.U1.token}`)
          .send({ trackId: tid });
      }

      const res = await request(ctx.app.getHttpServer())
        .post(`/api/v1/playlists/${playlistId}/reorder`)
        .set('Authorization', `Bearer ${ctx.tokens.U2.token}`)
        .send({ from: 1, to: 2 });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');

      // No write — positions unchanged (T1=1, T2=2).
      const rows = await prisma.playlistTrack.findMany({
        where: { playlistId },
        orderBy: { position: 'asc' },
      });
      expect(rows.map((r) => ({ position: r.position, trackId: r.trackId }))).toEqual([
        { position: 1, trackId: T1 },
        { position: 2, trackId: T2 },
      ]);
    });

    it('Mutation on a missing playlist returns 404, not 403 (NotFoundError precedence)', async () => {
      const missingId = '00000000-0000-0000-0000-0000000000ff';

      // The existence check runs BEFORE the ownership check — a non-owner
      // cannot learn whether a UUID exists. Test with PATCH (representative;
      // loadOwnedPlaylist is the same helper for all five mutations).
      const res = await request(ctx.app.getHttpServer())
        .patch(`/api/v1/playlists/${missingId}`)
        .set('Authorization', `Bearer ${ctx.tokens.U2.token}`)
        .send({ title: 'Ghost' });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });
});
