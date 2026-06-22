import { PrismaClient } from '@prisma/client';

import { loadConfig } from '../src/config';

/**
 * Deterministic synthetic dataset for the catalog bounded context.
 *
 * Spec Requirement 8 (catalog): "running twice produces identical state".
 * `crypto.randomUUID` is non-deterministic; `Math.random` is non-deterministic.
 * Both are forbidden here. Instead we use:
 *
 *   1. A mulberry32 PRNG seeded with a fixed 32-bit constant. mulberry32 is a
 *      tiny, well-understood seedable PRNG; the seed is part of the contract
 *      — changing it changes every UUID and every duration.
 *   2. A deterministic UUID v4 helper that consumes 16 bytes from the PRNG and
 *      sets the version (4) and variant (10xx) nibbles per RFC 4122.
 *   3. Pinned `const` fixture arrays in source order: 5 artists × 2 albums ×
 *      4 tracks = 10 albums + 40 tracks. The arrays are the single source of
 *      truth that the snapshot spec compares against.
 *
 * The seed is wired via `package.json` -> `prisma.seed` -> `tsx prisma/seed.ts`
 * so `pnpm db:seed` runs it end-to-end against the configured DATABASE_URL.
 * Tests import `runSeed(prisma)` directly so they can target a testcontainer
 * without spawning a child process.
 */

/** Fixed seed constant — part of the deterministic contract. Change => churn. */
const SEED = 0xc4a10ca7;

/**
 * mulberry32 — a tiny seedable PRNG. Returns a function that produces a
 * 32-bit float in [0, 1). Same seed always yields the same sequence.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Shape of every catalog row that the snapshot spec compares against. */
export interface SeedSnapshot {
  artists: Array<{ id: string; name: string; bio: string | null; image_url: string | null }>;
  albums: Array<{
    id: string;
    title: string;
    release_year: number | null;
    cover_url: string | null;
    artist_id: string;
  }>;
  tracks: Array<{
    id: string;
    title: string;
    duration_seconds: number;
    file_path: string;
    track_number: number;
    album_id: string;
  }>;
}

/**
 * Produce a deterministic RFC 4122 v4 UUID from 16 bytes drawn off the PRNG.
 *
 * The version nibble is set to `0100` (4) and the variant nibble to `10xx`
 * (one of 8, 9, a, b). Two consecutive `prng()` calls yield one 32-bit word
 * each; four words = 16 bytes = one UUID. The output is lowercase hex with
 * dashes at the canonical positions.
 */
function deterministicUuidV4(prng: () => number): string {
  // 4 calls -> 4 32-bit words -> 16 bytes.
  const words = [prng(), prng(), prng(), prng()].map((n) => Math.floor(n * 0x100000000));
  const bytes = new Uint8Array(16);
  const dv = new DataView(bytes.buffer);
  words.forEach((w, i) => dv.setUint32(i * 4, w, false));
  // Version (top nibble of byte 6) = 4.
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  // Variant (top two bits of byte 8) = 10.
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

const ARTIST_NAMES = [
  'Artist One',
  'Artist Two',
  'Artist Three',
  'Artist Four',
  'Artist Five',
] as const;

const ALBUM_TITLES_PER_ARTIST = [['Album One', 'Album Two']] as const;

const TRACK_TITLES_PER_ALBUM = [
  ['Track One', 'Track Two', 'Track Three', 'Track Four'],
] as const;

/**
 * Build the full dataset deterministically from the fixed seed. The Prisma
 * client is NOT touched here — this is a pure function over the PRNG so the
 * seed can be reasoned about without a database.
 *
 * Layout: 5 artists, each with 2 albums; each album has 4 tracks. Durations
 * are 180–300s (3–5 minutes) derived from the PRNG.
 */
function buildDataset(): {
  artists: Array<{ id: string; name: string; bio: string | null; image_url: string | null }>;
  albums: Array<{
    id: string;
    title: string;
    release_year: number | null;
    cover_url: string | null;
    artist_id: string;
  }>;
  tracks: Array<{
    id: string;
    title: string;
    duration_seconds: number;
    file_path: string;
    track_number: number;
    album_id: string;
  }>;
} {
  const prng = mulberry32(SEED);
  const artists: SeedSnapshot['artists'] = [];
  const albums: SeedSnapshot['albums'] = [];
  const tracks: SeedSnapshot['tracks'] = [];

  for (const name of ARTIST_NAMES) {
    const artistId = deterministicUuidV4(prng);
    artists.push({ id: artistId, name, bio: null, image_url: null });

    // Fixed fixture of two album titles per artist; both share the same
    // array because the source order is part of the deterministic contract.
    const albumTitles = ALBUM_TITLES_PER_ARTIST[0]!;
    for (const title of albumTitles) {
      const albumId = deterministicUuidV4(prng);
      albums.push({
        id: albumId,
        title,
        release_year: null,
        cover_url: null,
        artist_id: artistId,
      });

      const trackTitles = TRACK_TITLES_PER_ALBUM[0]!;
      let trackNumber = 1;
      for (const trackTitle of trackTitles) {
        // 180–300s — 3 to 5 minutes, derived from the PRNG. `Math.floor` +
        // offset keeps the range inclusive of 180, exclusive of 300.
        const durationSeconds = Math.floor(prng() * 120) + 180;
        const trackId = deterministicUuidV4(prng);
        tracks.push({
          id: trackId,
          title: trackTitle,
          duration_seconds: durationSeconds,
          file_path: `/audio/${albumId}/${trackId}.mp3`,
          track_number: trackNumber,
          album_id: albumId,
        });
        trackNumber += 1;
      }
    }
  }

  return { artists, albums, tracks };
}

/**
 * Insert every row in dependency order (artists -> albums -> tracks) inside a
 * single `$transaction`. The Prisma client must already be connected to a
 * database that has had `0000_init` and `0001_catalog` applied.
 *
 * Idempotent at the row level ONLY when the caller has TRUNCATEd first —
 * re-running without truncating will accumulate duplicates because every run
 * generates fresh UUIDs (deterministic, but Prisma sees them as new rows).
 */
export async function runSeed(prisma: PrismaClient): Promise<void> {
  const { artists, albums, tracks } = buildDataset();

  await prisma.$transaction([
    ...artists.map((a) =>
      prisma.$executeRaw`INSERT INTO "artists" ("id", "name", "bio", "image_url") VALUES (${a.id}::uuid, ${a.name}, ${a.bio}, ${a.image_url})`,
    ),
    ...albums.map((a) =>
      prisma.$executeRaw`INSERT INTO "albums" ("id", "title", "release_year", "cover_url", "artist_id") VALUES (${a.id}::uuid, ${a.title}, ${a.release_year}, ${a.cover_url}, ${a.artist_id}::uuid)`,
    ),
    ...tracks.map((t) =>
      prisma.$executeRaw`INSERT INTO "tracks" ("id", "title", "duration_seconds", "file_path", "track_number", "album_id") VALUES (${t.id}::uuid, ${t.title}, ${t.duration_seconds}, ${t.file_path}, ${t.track_number}, ${t.album_id}::uuid)`,
    ),
  ]);
}

// CLI entrypoint — runs the seed against the configured DATABASE_URL. Triggered
// by `pnpm db:seed` -> `prisma db seed` -> `ts-node prisma/seed.ts`. Guarded by
// the `require.main === module` check so importing the module (from the spec)
// does not eagerly connect.
//
// `require.main` is the CommonJS idiom for "am I the entry script?" — kept as
// `require` because Prisma's seed runner spawns this file via ts-node in CJS
// mode (package.json declares `"type": "commonjs"`).
if (require.main === module) {
  const cfg = loadConfig();
  const prisma = new PrismaClient({ datasources: { db: { url: cfg.DATABASE_URL } } });
  runSeed(prisma)
    .then(() => {
      console.log('Seed completed.');
    })
    .catch((err) => {
      console.error('Seed failed:', err);
      process.exitCode = 1;
    })
    .finally(() => {
      void prisma.$disconnect();
    });
}
