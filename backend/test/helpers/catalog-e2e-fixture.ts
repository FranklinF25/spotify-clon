import { Prisma, type PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';

/**
 * Canonical e2e catalog fixture: 5 artists × 2 albums × 4 tracks
 * (CAT-PR2b2-01 shape, preserved verbatim from the retired synthetic
 * `prisma/seed.ts` dataset).
 *
 * WHY this exists: `prisma/seed.ts` now scans the real host audio library
 * (`<AUDIO_STORAGE_PATH>/audio` via music-metadata), so it can no longer
 * provide a fixed-shape fixture for the e2e suite. The catalog e2e specs
 * assert exact totals (5 artists / 10 albums / 40 tracks) and token matches
 * ("one" ↔ "Artist One" / "Album One" / "Track One"), which requires a
 * SELF-CONTAINED dataset that never depends on reviewer-supplied audio.
 * Test hermeticity wins: e2e seeds its own rows, the production seeder
 * serves the real library.
 *
 * Deterministic UUIDs: SHA-256-derived v5-style digests of stable keys
 * (same construction as `prisma/seed.ts#deriveDeterministicId`) so repeated
 * fixture inserts are idempotent and snapshot-stable across runs.
 */

/** Deterministic v5-style UUID from a stable key (mirrors seed.ts). */
function fixtureId(key: string): string {
  const digest = createHash('sha256').update(key, 'utf8').digest().subarray(0, 16);
  digest[6] = (digest[6]! & 0x0f) | 0x50;
  digest[8] = (digest[8]! & 0x3f) | 0x80;
  const hex = Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

const ARTIST_NAMES = ['Artist One', 'Artist Two', 'Artist Three', 'Artist Four', 'Artist Five'];
const ALBUM_TITLES = ['Album One', 'Album Two'];
const TRACK_TITLES = ['Track One', 'Track Two', 'Track Three', 'Track Four'];

/**
 * Insert the canonical 5 × 2 × 4 fixture in dependency order inside one
 * transaction. Idempotent per row (`ON CONFLICT ("id") DO NOTHING`) so
 * `resetCatalog` can truncate + re-insert without duplicate-key noise.
 */
export async function insertCanonicalCatalogFixture(prisma: PrismaClient): Promise<void> {
  const statements: Prisma.PrismaPromise<number>[] = [];

  for (const [artistIndex, name] of ARTIST_NAMES.entries()) {
    const artistId = fixtureId(`e2e-fixture:artist:${artistIndex}`);
    statements.push(
      prisma.$executeRaw`
        INSERT INTO "artists" ("id", "name", "bio", "image_url")
        VALUES (${artistId}::uuid, ${name}, NULL, NULL)
        ON CONFLICT ("id") DO NOTHING
      `,
    );

    for (const [albumIndex, albumTitle] of ALBUM_TITLES.entries()) {
      const albumId = fixtureId(`e2e-fixture:album:${artistIndex}:${albumIndex}`);
      statements.push(
        prisma.$executeRaw`
          INSERT INTO "albums" ("id", "title", "release_year", "cover_url", "artist_id")
          VALUES (${albumId}::uuid, ${albumTitle}, NULL, NULL, ${artistId}::uuid)
          ON CONFLICT ("id") DO NOTHING
        `,
      );

      for (const [trackIndex, trackTitle] of TRACK_TITLES.entries()) {
        const trackId = fixtureId(`e2e-fixture:track:${artistIndex}:${albumIndex}:${trackIndex}`);
        statements.push(
          prisma.$executeRaw`
            INSERT INTO "tracks" ("id", "title", "duration_seconds", "file_path", "track_number", "album_id")
            VALUES (
              ${trackId}::uuid,
              ${`${name} ${trackTitle}`},
              ${180 + trackIndex * 10},
              ${`/audio/${albumId}/${trackId}.mp3`},
              ${trackIndex + 1},
              ${albumId}::uuid
            )
            ON CONFLICT ("id") DO NOTHING
          `,
        );
      }
    }
  }

  await prisma.$transaction(statements);
}
