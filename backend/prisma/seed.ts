import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import { PrismaClient } from '@prisma/client';
import { parseFile } from 'music-metadata';

import { loadConfig } from '../src/config';

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
 * Fallbacks when tags are missing (all pure + exported for the spec):
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

/** Accepted audio extensions (case-insensitive, compared lowercased). */
export const AUDIO_EXTENSIONS = ['.mp3', '.flac', '.ogg', '.m4a', '.wav', '.opus'] as const;

/** Filename-fallback artist when no ` - ` separator (or no artist tag). */
export const FALLBACK_ARTIST_NAME = 'Unknown Artist';

/** Album fallback — the flat `Artist - Title.ext` layout has no album context. */
export const FALLBACK_ALBUM_TITLE = 'Singles';

/**
 * Duration floor. `duration_seconds` feeds the SPA progress bar (divide by
 * total); 0 would produce Infinity/NaN progress. 1s is the sane floor for a
 * truly unparsable file.
 */
const MIN_DURATION_SECONDS = 1;

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

/** Tag-derived + fallback-resolved metadata for ONE scanned audio file. */
export interface AudioFileMeta {
  artist: string;
  album: string;
  title: string;
  year: number | null;
  trackNo: number | null;
  durationSeconds: number;
}

/** One accepted file under the audio root, with its resolved metadata. */
export interface ScannedAudioFile {
  /** Path relative to the audio root, POSIX separators (e.g. `Artist - Title.flac`). */
  relativePath: string;
  meta: AudioFileMeta;
}

/** True when the filename carries an accepted audio extension (case-insensitive). */
export function isAudioFile(fileName: string): boolean {
  const ext = path.extname(fileName).toLowerCase();
  return (AUDIO_EXTENSIONS as readonly string[]).includes(ext);
}

/**
 * Filename fallback: split `Artist - Title.ext` on the FIRST ` - `.
 *
 * Artist ← left of the first separator, title ← right side WITHOUT the
 * extension. Files without a separator become title-only (artist falls back
 * to `Unknown Artist`). Splits on the FIRST separator only, so titles that
 * themselves contain ` - ` (`A - B - C.flac` → artist `A`, title `B - C`)
 * survive intact.
 */
export function parseArtistTitleFromFilename(fileName: string): {
  artist: string;
  title: string;
} {
  const stem = path.basename(fileName, path.extname(fileName));
  const separator = stem.indexOf(' - ');
  const artist = (separator === -1 ? '' : stem.slice(0, separator)).trim();
  const title = (separator === -1 ? stem : stem.slice(separator + 3)).trim();
  return {
    artist: artist || FALLBACK_ARTIST_NAME,
    title: title || stem.trim() || fileName,
  };
}

/**
 * Duration resolution: `Math.round(format.duration)` when present and
 * positive; the 1s floor otherwise. 0 is NOT acceptable (SPA progress math).
 */
export function resolveDurationSeconds(duration: number | undefined): number {
  if (typeof duration === 'number' && Number.isFinite(duration) && duration > 0) {
    return Math.max(MIN_DURATION_SECONDS, Math.round(duration));
  }
  return MIN_DURATION_SECONDS;
}

/**
 * Release-year resolution: prefer `common.year`; fall back to the first
 * 4-digit run in `common.date` (e.g. `2019-08-09` → 2019); null when neither
 * yields a plausible positive year.
 */
export function resolveYear(year?: number, date?: string): number | null {
  if (typeof year === 'number' && Number.isFinite(year) && year > 0) {
    return Math.round(year);
  }
  if (typeof date === 'string') {
    const match = /(\d{4})/.exec(date);
    if (match) {
      const parsed = Number.parseInt(match[1]!, 10);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
  }
  return null;
}

/**
 * Deterministic RFC 4122 v5-style UUID from the SHA-256 of a stable key.
 *
 * Same construction as a real v5 UUID (namespace-less: the key itself
 * carries the `artist:` / `album:` / `track:` namespace prefix), digesting
 * with SHA-256 instead of v5's SHA-1 and taking the first 16 bytes. Version nibble
 * is forced to `0101` (5) and the variant nibble to `10xx` per RFC 4122 —
 * same byte surgery the old PRNG v4 helper did, different digest source.
 * Equal key ⇒ equal UUID ⇒ idempotent re-seeds.
 */
export function deriveDeterministicId(key: string): string {
  const digest = createHash('sha256').update(key, 'utf8').digest();
  const bytes = digest.subarray(0, 16);
  // Version (top nibble of byte 6) = 5.
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  // Variant (top two bits of byte 8) = 10.
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Merge parsed tags with the filename/constant fallbacks into the final
 * per-file metadata. Pure — the spec exercises every fallback branch here
 * without touching a real audio file.
 */
export function resolveTrackMeta(
  relativePath: string,
  tags: {
    artist?: string;
    album?: string;
    title?: string;
    year?: number;
    date?: string;
    trackNo?: number | null;
    duration?: number;
  },
): AudioFileMeta {
  const fileName = relativePath.split('/').pop() ?? relativePath;
  const fallback = parseArtistTitleFromFilename(fileName);
  const cleanTag = (value: string | undefined): string =>
    typeof value === 'string' ? value.trim() : '';
  const hasTrackNo =
    typeof tags.trackNo === 'number' && Number.isInteger(tags.trackNo) && tags.trackNo > 0;

  return {
    artist: cleanTag(tags.artist) || fallback.artist,
    album: cleanTag(tags.album) || FALLBACK_ALBUM_TITLE,
    title: cleanTag(tags.title) || fallback.title,
    year: resolveYear(tags.year, tags.date),
    trackNo: hasTrackNo ? (tags.trackNo as number) : null,
    durationSeconds: resolveDurationSeconds(tags.duration),
  };
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
