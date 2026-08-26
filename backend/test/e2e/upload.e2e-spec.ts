import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { deriveDeterministicId } from '../../src/shared/audio-meta';
import {
  type UploadE2eContext,
  registerUser,
  startUploadE2E,
} from '../helpers/upload-e2e-app';

/**
 * `POST /api/v1/tracks/upload` e2e (REQ-UPLOAD-001 … REQ-UPLOAD-004).
 *
 * Proves the upload pipeline END-TO-END over real HTTP + a real Postgres 16
 * container + a scratch audio root:
 *
 *   1. 401 unauthenticated (class-level JwtAuthGuard).
 *   2. Happy path — `.attach('file', fixtures/audio/sample.mp3)` → 201 with
 *      the EXACT response contract (`{ track, artist, album }`), the bytes
 *      on disk under the scratch audio root, and ids byte-identical to the
 *      seeder derivation for the same relative path (pinned in-spec via
 *      the shared kernel). The fixture mp3 carries NO tags, so this ALSO
 *      exercises the filename fallback chain (`sample.mp3` → title
 *      `sample`, artist `Unknown Artist`, album `Singles`, 1s duration).
 *   3. Immediate playability of the catalog side — after upload, with NO
 *      re-seed or restart: `GET /tracks/:id` returns the track (this is
 *      the row playback streams from) and `GET /search?q=` finds it.
 *   4. Idempotent re-upload — the same file again → 201, SAME ids, no
 *      duplicate rows (files + artist/album/track counts all stay at 1).
 *   5. Validation matrix — no `file` part → 400 VALIDATION_ERROR with
 *      `details[0].field === 'file'`; non-audio extension → same envelope.
 *
 * Streaming the uploaded bytes back is deliberately NOT asserted here —
 * playback keeps its own e2e suite with its own fixtures; this spec proves
 * the catalog side (row present, searchable, file on disk at the path the
 * storage adapter resolves).
 */
describe('POST /api/v1/tracks/upload', () => {
  let ctx: UploadE2eContext;
  let token: string;
  const fixturePath = resolve(__dirname, '..', 'fixtures', 'audio', 'sample.mp3');
  const fixtureBytes = readFileSync(fixturePath);

  beforeAll(async () => {
    ctx = await startUploadE2E();
    token = await registerUser(ctx.app, 'catalog-upload@example.com');
  }, 90_000);
  afterAll(async () => {
    await ctx.cleanup();
  });

  it('returns 401 without a Bearer token', async () => {
    const res = await request(ctx.app.getHttpServer())
      .post('/api/v1/tracks/upload')
      .attach('file', fixturePath);

    expect(res.status).toBe(401);
    expect(res.body.error).toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('uploads the fixture mp3 → 201 contract, file on disk, seeder-identical ids', async () => {
    const res = await request(ctx.app.getHttpServer())
      .post('/api/v1/tracks/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', fixturePath);

    expect(res.status).toBe(201);

    // Pinned derivation vector — the SAME helpers the seeder uses, over the
    // SAME relative path an on-disk scan would produce. A re-seed after
    // this upload upserts these exact rows instead of duplicating.
    const expectedArtistId = deriveDeterministicId('artist:Unknown Artist');
    const expectedAlbumId = deriveDeterministicId(`album:${expectedArtistId}:Singles`);
    const expectedTrackId = deriveDeterministicId('track:sample.mp3');

    expect(res.body).toEqual({
      track: {
        id: expectedTrackId,
        title: 'sample',
        durationSeconds: 1,
        albumId: expectedAlbumId,
      },
      artist: { id: expectedArtistId, name: 'Unknown Artist' },
      album: { id: expectedAlbumId, title: 'Singles' },
    });
    // R4 guard: no storage path leaks into the upload response.
    expect(JSON.stringify(res.body)).not.toContain('filePath');

    // The bytes landed under the scratch audio root at the derived path.
    const onDisk = resolve(ctx.audioRoot, 'sample.mp3');
    expect(existsSync(onDisk)).toBe(true);
    expect(readFileSync(onDisk).equals(fixtureBytes)).toBe(true);

    // The DB row carries the seed-style rooted filePath the playback
    // storage adapter resolves against AUDIO_STORAGE_PATH.
    const row = await ctx.prisma.track.findUnique({ where: { id: expectedTrackId } });
    expect(row).toMatchObject({
      title: 'sample',
      durationSeconds: 1,
      filePath: '/audio/sample.mp3',
      trackNumber: 1,
      albumId: expectedAlbumId,
    });
  });

  it('makes the track immediately playable on the catalog side (detail + search)', async () => {
    const expectedTrackId = deriveDeterministicId('track:sample.mp3');

    // GET /tracks/:id — the row playback resolves streams from (R4 shape,
    // no filePath).
    const detail = await request(ctx.app.getHttpServer())
      .get(`/api/v1/tracks/${expectedTrackId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({ id: expectedTrackId, title: 'sample' });
    expect('filePath' in detail.body).toBe(false);

    // GET /search?q=sample — the uploaded title is full-text searchable
    // with NO re-seed (the upserted tsvector-generated row is live).
    const search = await request(ctx.app.getHttpServer())
      .get('/api/v1/search?q=sample')
      .set('Authorization', `Bearer ${token}`);
    expect(search.status).toBe(200);
    expect(search.body.tracks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: expectedTrackId, title: 'sample' }),
      ]),
    );
  });

  it('re-uploading the same file overwrites idempotently (same ids, no duplicates)', async () => {
    const expectedTrackId = deriveDeterministicId('track:sample.mp3');

    const res = await request(ctx.app.getHttpServer())
      .post('/api/v1/tracks/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', fixturePath);

    expect(res.status).toBe(201);
    expect(res.body.track.id).toBe(expectedTrackId);

    // One artist, one album, one track — the upsert hit the same rows.
    const [artists, albums, tracks] = await Promise.all([
      ctx.prisma.artist.count(),
      ctx.prisma.album.count(),
      ctx.prisma.track.count(),
    ]);
    expect(artists).toBe(1);
    expect(albums).toBe(1);
    expect(tracks).toBe(1);
  });

  it('rejects a request without a file part with VALIDATION_ERROR on field "file"', async () => {
    // Multipart body with NO file field.
    const res = await request(ctx.app.getHttpServer())
      .post('/api/v1/tracks/upload')
      .set('Authorization', `Bearer ${token}`)
      .field('not-file', 'value');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      details: [{ field: 'file', issue: expect.any(String) }],
    });
  });

  it('rejects a non-multipart body with VALIDATION_ERROR on field "file"', async () => {
    const res = await request(ctx.app.getHttpServer())
      .post('/api/v1/tracks/upload')
      .set('Authorization', `Bearer ${token}`)
      .send({ foo: 'bar' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      details: [{ field: 'file', issue: expect.any(String) }],
    });
  });

  it('rejects a non-audio extension with VALIDATION_ERROR on field "file"', async () => {
    const res = await request(ctx.app.getHttpServer())
      .post('/api/v1/tracks/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('plain text, not audio'), 'notes.txt');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      details: [{ field: 'file', issue: expect.stringContaining('.mp3') }],
    });
    // Nothing was written or upserted for the rejected file.
    expect(existsSync(resolve(ctx.audioRoot, 'notes.txt'))).toBe(false);
    expect(await ctx.prisma.track.count()).toBe(1);
  });
});
