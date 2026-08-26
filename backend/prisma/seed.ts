import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import { PrismaClient } from '@prisma/client';
import { parseFile } from 'music-metadata';

import {
  type AudioFileMeta,
  deriveDeterministicId,
  isAudioFile,
  resolveTrackMeta,
} from '../src/shared/audio-meta';
import { loadConfig } from '../src/config';

// Re-export the shared derivation kernel VERBATIM (single source of truth —
// the upload use case derives ids/meta with the exact same helpers so an
// upload followed by a re-seed converges on the same rows instead of
// duplicating). `seed.spec.ts` keeps importing these from `./seed`.
export {
  AUDIO_EXTENSIONS,
  FALLBACK_ALBUM_TITLE,
  FALLBACK_ARTIST_NAME,
  type AudioFileMeta,
  deriveDeterministicId,
  isAudioFile,
  parseArtistTitleFromFilename,
  resolveDurationSeconds,
  resolveTrackMeta,
  resolveYear,
} from '../src/shared/audio-meta';

/**
 * Filesystem-scanning catalog seeder (replaces the synthetic PRNG dataset).
 *
 * The catalog is now seeded from the REAL audio library mounted at
 * `<AUDIO_STORAGE_PATH>/audio` (host `./audio`, flat layout, files named
 * `Artist - Title.flac` — REQ-DOCKER-006 read-only mount). Per file, tags are
 * parsed with `music-metadata` `parseFile` and grouped into
 * artists → albums (per artist, by title) → tracks.
 *
 * Determinism contract (catalog spec Requirement 8 — "running twice produces
 * identical state") is preserved WITHOUT a PRNG: every row id is a UUID
 * v5-style digest (SHA-256, version nibble 5 + variant 10xx) of a STABLE
 * content key:
 *
 *   - artist: `artist:{name}`
 *   - album:  `album:{artistId}:{title}`
 *   - track:  `track:{relativeFilePath}`
 *
 * Stable keys + `INSERT ... ON CONFLICT ("id") DO UPDATE` make `runSeed`
 * ROW-IDEMPOTENT: re-running syncs incremental changes (renamed titles, new
 * files) instead of accumulating duplicates. This is why the old count-guard
 * in `scripts/seed-with-guard.sh` was removed — warm restarts now re-run the
 * seed as a sync, never skipping (REQ-DOCKER-005 semantics updated).
 *
 * Fallbacks when tags are missing (all pure + re-exported from
 * `src/shared/audio-meta.ts` for the spec):
 *   - artist/title: filename split on the FIRST ` - ` (artist ← left side,
 *     title ← right side without extension); no separator → title = stem,
 *     artist = `'Unknown Artist'`.
 *   - album: `'Singles'` (flat single-file layout has no album context).
 *   - duration: `Math.round(format.duration)` when present; a 0 fallback is
 *     NOT acceptable (the SPA progress bar divides by it) — the floor is 1s.
 *   - `file_path` is stored as `/audio/{relativePath}` so it matches the
 *     `FsAudioStorage.resolve` contract (leading slash stripped, joined under
 *     AUDIO_STORAGE_PATH — see src/config.ts C8 note).
 *
 * The pure derivation helpers (fallbacks, id digest, meta resolution,
 * extension allowlist) live in `src/shared/audio-meta.ts` and are
 * re-exported below — the upload use case derives ids/meta with the SAME
 * helpers, so an upload followed by a re-seed converges on the same rows
 * instead of duplicating them.
 *
 * Empty or missing audio directory → clear warning + NO-OP: the seeder must
 * never wipe an existing catalog just because the mount is empty.
 *
 * Dependency note: `music-metadata` is pinned to v7 (`^7.14.0`) — the LAST
 * CommonJS-compatible major. v8+ is ESM-only and breaks the ts-node CJS
 * seed runner spawned by `prisma db seed` / the `seed` compose service.
 *
 * The seed is wired via `package.json` -> `prisma.seed` -> `ts-node
 * prisma/seed.ts` so `pnpm db:seed` runs it end-to-end against the
 * configured DATABASE_URL. Tests import the pure helpers + `runSeed`
 * directly (mocking `parseFile` at this module boundary — no real audio
 * files needed) and target a testcontainer without spawning a child process.
 */

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

/** One accepted file under the audio root, with its resolved metadata. */
export interface ScannedAudioFile {
  /** Path relative to the audio root, POSIX separators (e.g. `Artist - Title.flac`). */
  relativePath: string;
  meta: AudioFileMeta;
}

/**
 * Group scanned files into catalog rows with deterministic ids.
 *
 * Pure over its input: artists grouped by exact name, albums per artist by
 * title, tracks ordered by `track.no` then filename (null track numbers sort
 * last by filename). `track_number` falls back to the 1-based position so
 * the NOT NULL column stays satisfied without inventing offsets. `file_path`
 * is rooted at `/audio/...` per the FsAudioStorage.resolve contract.
 *
 * Album `release_year` is the first non-null track year in album track
 * order (deterministic given the stable input ordering).
 */
export function buildCatalog(files: ScannedAudioFile[]): SeedSnapshot {
  const artists = new Map<string, SeedSnapshot['artists'][number]>();
  const albums = new Map<string, SeedSnapshot['albums'][number]>();
  const tracksByAlbum = new Map<string, ScannedAudioFile[]>();

  for (const file of [...files].sort((a, b) =>
    a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0,
  )) {
    let artist = artists.get(file.meta.artist);
    if (!artist) {
      artist = {
        id: deriveDeterministicId(`artist:${file.meta.artist}`),
        name: file.meta.artist,
        bio: null,
        image_url: null,
      };
      artists.set(file.meta.artist, artist);
    }

    const albumKey = `${artist.id}:${file.meta.album}`;
    let album = albums.get(albumKey);
    if (!album) {
      album = {
        id: deriveDeterministicId(`album:${albumKey}`),
        title: file.meta.album,
        release_year: file.meta.year,
        cover_url: null,
        artist_id: artist.id,
      };
      albums.set(albumKey, album);
    } else if (album.release_year === null && file.meta.year !== null) {
      // First non-null year wins — deterministic under the sorted input.
      album.release_year = file.meta.year;
    }

    let bucket = tracksByAlbum.get(album.id);
    if (!bucket) {
      bucket = [];
      tracksByAlbum.set(album.id, bucket);
    }
    bucket.push(file);
  }

  const tracks: SeedSnapshot['tracks'] = [];
  for (const album of albums.values()) {
    const bucket = tracksByAlbum.get(album.id)!;
    bucket.sort((a, b) => {
      const aNo = a.meta.trackNo ?? Number.POSITIVE_INFINITY;
      const bNo = b.meta.trackNo ?? Number.POSITIVE_INFINITY;
      if (aNo !== bNo) return aNo - bNo;
      return a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0;
    });
    bucket.forEach((file, index) => {
      tracks.push({
        id: deriveDeterministicId(`track:${file.relativePath}`),
        title: file.meta.title,
        duration_seconds: file.meta.durationSeconds,
        file_path: `/audio/${file.relativePath}`,
        track_number: file.meta.trackNo ?? index + 1,
        album_id: album.id,
      });
    });
  }

  return { artists: [...artists.values()], albums: [...albums.values()], tracks };
}

/**
 * Recursively list accepted audio files under `audioRoot` and parse each
 * with `music-metadata` `parseFile`.
 *
 * Deterministic scan order: directory entries are sorted by name at every
 * level, so `buildCatalog` sees a stable input sequence across platforms.
 * A file whose tags fail to parse (corrupt header, unsupported codec) is NOT
 * dropped — it degrades to the filename fallbacks with the 1s duration floor
 * and a stderr warning, because the file IS part of the library.
 */
export async function scanAudioFiles(audioRoot: string): Promise<ScannedAudioFile[]> {
  const relativePaths: string[] = [];

  async function walk(absoluteDir: string, relativeDir: string): Promise<void> {
    const entries = await fs.readdir(absoluteDir, { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(path.join(absoluteDir, entry.name), relativePath);
      } else if (entry.isFile() && isAudioFile(entry.name)) {
        relativePaths.push(relativePath);
      }
    }
  }

  await walk(audioRoot, '');

  const scanned: ScannedAudioFile[] = [];
  for (const relativePath of relativePaths) {
    const absolutePath = path.join(audioRoot, relativePath);
    try {
      const parsed = await parseFile(absolutePath);
      scanned.push({
        relativePath,
        meta: resolveTrackMeta(relativePath, {
          artist: parsed.common.artist,
          album: parsed.common.album,
          title: parsed.common.title,
          year: parsed.common.year,
          date: parsed.common.date,
          trackNo: parsed.common.track?.no ?? null,
          duration: parsed.format.duration,
        }),
      });
    } catch (err) {
      // Degrade to filename fallbacks — never drop the file from the catalog.
      console.warn(`[seed] Tag parse failed for ${absolutePath} — using filename fallbacks.`, err);
      scanned.push({ relativePath, meta: resolveTrackMeta(relativePath, {}) });
    }
  }
  return scanned;
}

/**
 * Audio root scanned by the seed: `<AUDIO_STORAGE_PATH>/audio`.
 *
 * AUDIO_STORAGE_PATH is the PARENT of the audio dir (config.ts C8 note): in
 * the compose stack it is `/data`, so the scan root is `/data/audio` — the
 * same directory `FsAudioStorage` resolves seed-stored `/audio/...` paths
 * against.
 */
export function resolveAudioRoot(config: { AUDIO_STORAGE_PATH: string }): string {
  return path.join(config.AUDIO_STORAGE_PATH, 'audio');
}

/**
 * Upsert the scanned catalog in dependency order (artists → albums →
 * tracks) inside a single `$transaction`.
 *
 * Row-idempotent by construction: deterministic ids from stable content
 * keys + `ON CONFLICT ("id") DO UPDATE` on every mutable column. Re-running
 * syncs changed titles/durations/years instead of duplicating rows, so both
 * a cold database and a warm restart converge to the on-disk library.
 *
 * The Prisma client must already be connected to a database that has had
 * `0000_init` and `0001_catalog` applied. An empty or missing audio root is
 * a NO-OP with a warning — never a wipe of the existing catalog.
 */
export async function runSeed(
  prisma: PrismaClient,
  audioRoot: string = resolveAudioRoot(loadConfig()),
): Promise<void> {
  let files: ScannedAudioFile[];
  try {
    files = await scanAudioFiles(audioRoot);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      console.warn(
        `[seed] Audio directory not found (${audioRoot}) — leaving existing catalog rows untouched.`,
      );
      return;
    }
    throw err;
  }

  if (files.length === 0) {
    console.warn(
      `[seed] No audio files found under ${audioRoot} — leaving existing catalog rows untouched.`,
    );
    return;
  }

  const { artists, albums, tracks } = buildCatalog(files);

  await prisma.$transaction([
    ...artists.map((a) =>
      prisma.$executeRaw`
        INSERT INTO "artists" ("id", "name", "bio", "image_url")
        VALUES (${a.id}::uuid, ${a.name}, ${a.bio}, ${a.image_url})
        ON CONFLICT ("id") DO UPDATE SET
          "name" = EXCLUDED."name",
          "bio" = EXCLUDED."bio",
          "image_url" = EXCLUDED."image_url"
      `,
    ),
    ...albums.map((a) =>
      prisma.$executeRaw`
        INSERT INTO "albums" ("id", "title", "release_year", "cover_url", "artist_id")
        VALUES (${a.id}::uuid, ${a.title}, ${a.release_year}, ${a.cover_url}, ${a.artist_id}::uuid)
        ON CONFLICT ("id") DO UPDATE SET
          "title" = EXCLUDED."title",
          "release_year" = EXCLUDED."release_year",
          "cover_url" = EXCLUDED."cover_url",
          "artist_id" = EXCLUDED."artist_id"
      `,
    ),
    ...tracks.map((t) =>
      prisma.$executeRaw`
        INSERT INTO "tracks" ("id", "title", "duration_seconds", "file_path", "track_number", "album_id")
        VALUES (${t.id}::uuid, ${t.title}, ${t.duration_seconds}, ${t.file_path}, ${t.track_number}, ${t.album_id}::uuid)
        ON CONFLICT ("id") DO UPDATE SET
          "title" = EXCLUDED."title",
          "duration_seconds" = EXCLUDED."duration_seconds",
          "file_path" = EXCLUDED."file_path",
          "track_number" = EXCLUDED."track_number",
          "album_id" = EXCLUDED."album_id"
      `,
    ),
  ]);

  console.log(
    `[seed] Synced ${artists.length} artists, ${albums.length} albums, ${tracks.length} tracks from ${audioRoot}.`,
  );
}

// CLI entrypoint — runs the seed against the configured DATABASE_URL. Triggered
// by `pnpm db:seed` -> `prisma db seed` -> `ts-node prisma/seed.ts` and by the
// compose `seed` service via `scripts/seed-with-guard.sh`. Guarded by the
// `require.main === module` check so importing the module (from the spec)
// does not eagerly connect or scan.
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
