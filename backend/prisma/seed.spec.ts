import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startTestDb, type TestDbContext } from '../test/helpers/test-db';
import { runSeed, type SeedSnapshot } from './seed';

/**
 * Integration spec for the deterministic seed script (CAT-PR1-06; spec
 * Requirement 8 — "Seed is deterministic and non-empty").
 *
 * Strategy: spin up a fresh PG16 testcontainer, run the seed twice against
 * independent clean slates (truncate between runs), and assert byte-identical
 * snapshots (UUIDs, names, titles, durations, counts). The Prisma migration
 * `0001_catalog` is applied automatically by `startTestDb`.
 *
 * Non-empty assertion: at least 1 artist, 1 album, 1 track after seeding
 * (the spec scenario requires "non-empty count").
 */
describe('prisma/seed — deterministic synthetic catalog', () => {
  let db: TestDbContext;

  // hookTimeout bumped to 60s — under full-suite parallelism (catalog +
  // playback + playlists e2e + integration specs all booting Postgres 16
  // testcontainers concurrently) the default 10s beforeAll was racing the
  // container-start and timing out. Mirrors the playlists integration-spec
  // bump (79abadf). The spec itself is deterministic; this is a concurrency
  // mitigation, not a relaxed assertion.
  beforeAll(async () => {
    db = await startTestDb();
  }, 60_000);

  afterAll(async () => {
    await db.cleanup();
  });

  it('produces a non-empty dataset on a clean database', async () => {
    await db.truncate();
    await runSeed(db.prisma);
    const snapshot = await snapshotCatalog(db);
    expect(snapshot.artists.length).toBeGreaterThan(0);
    expect(snapshot.albums.length).toBeGreaterThan(0);
    expect(snapshot.tracks.length).toBeGreaterThan(0);
  });

  it('produces byte-identical identifiers, names, titles, and durations across two independent runs', async () => {
    // Run 1
    await db.truncate();
    await runSeed(db.prisma);
    const first = await snapshotCatalog(db);

    // Run 2 — clean slate, seed again
    await db.truncate();
    await runSeed(db.prisma);
    const second = await snapshotCatalog(db);

    expect(second.artists).toEqual(first.artists);
    expect(second.albums).toEqual(first.albums);
    expect(second.tracks).toEqual(first.tracks);
  });

  it('uses UUID v4 identifiers (version nibble = 4) for every row', async () => {
    await db.truncate();
    await runSeed(db.prisma);
    const snapshot = await snapshotCatalog(db);
    const allIds = [
      ...snapshot.artists.map((a) => a.id),
      ...snapshot.albums.map((a) => a.id),
      ...snapshot.tracks.map((t) => t.id),
    ];
    expect(allIds.length).toBeGreaterThan(0);
    for (const id of allIds) {
      // UUID v4: the version nibble (char at position 14) MUST be '4'.
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
  });

  it('seeds the fixed portfolio shape: 5 artists, 10 albums, 40 tracks', async () => {
    await db.truncate();
    await runSeed(db.prisma);
    const snapshot = await snapshotCatalog(db);
    // 5 artists × 2 albums × 4 tracks = 10 albums + 40 tracks.
    expect(snapshot.artists).toHaveLength(5);
    expect(snapshot.albums).toHaveLength(10);
    expect(snapshot.tracks).toHaveLength(40);
  });
});

/**
 * Snapshot every catalog row in a stable order so two seed runs can be
 * compared structurally. The order is `created_at`-then-`id` so the fixture
 * insertion order (which is deterministic) surfaces consistently.
 */
async function snapshotCatalog(db: TestDbContext): Promise<SeedSnapshot> {
  const [artists, albums, tracks] = await Promise.all([
    db.prisma.$queryRaw<
      Array<{ id: string; name: string; bio: string | null; image_url: string | null }>
    >`SELECT id, name, bio, image_url FROM artists ORDER BY created_at ASC, id ASC`,
    db.prisma.$queryRaw<
      Array<{
        id: string;
        title: string;
        release_year: number | null;
        cover_url: string | null;
        artist_id: string;
      }>
    >`SELECT id, title, release_year, cover_url, artist_id FROM albums ORDER BY created_at ASC, id ASC`,
    db.prisma.$queryRaw<
      Array<{
        id: string;
        title: string;
        duration_seconds: number;
        file_path: string;
        track_number: number;
        album_id: string;
      }>
    >`SELECT id, title, duration_seconds, file_path, track_number, album_id FROM tracks ORDER BY created_at ASC, id ASC`,
  ]);
  return { artists, albums, tracks };
}
