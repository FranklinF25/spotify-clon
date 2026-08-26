import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseFile } from 'music-metadata';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { startTestDb, type TestDbContext } from '../test/helpers/test-db';
import {
  AUDIO_EXTENSIONS,
  buildCatalog,
  deriveDeterministicId,
  isAudioFile,
  parseArtistTitleFromFilename,
  resolveDurationSeconds,
  resolveTrackMeta,
  resolveYear,
  runSeed,
  type ScannedAudioFile,
  type SeedSnapshot,
} from './seed';

/**
 * Spec for the filesystem-scanning catalog seeder (CAT-PR1-06 successor —
 * catalog spec Requirement 8 "Seed is deterministic and non-empty" now holds
 * via content-derived deterministic ids + row-idempotent upserts).
 *
 * Two layers:
 *
 *  1. PURE helper specs — filename fallbacks, duration floor, year
 *     resolution, id derivation, and `buildCatalog` grouping run with zero
 *     I/O. No real audio files are needed: `music-metadata` is mocked at the
 *     module boundary (`vi.mock`) so `scanAudioFiles`/`runSeed` exercise the
 *     orchestration against controlled canned tags.
 *  2. INTEGRATION specs — a real PG16 testcontainer (migrations applied by
 *     `startTestDb`) proves `runSeed` is row-idempotent: seeding TWICE
 *     without truncating yields a byte-identical snapshot, a changed tag
 *     updates the existing row (ON CONFLICT DO UPDATE, not DO NOTHING), and
 *     an empty/missing audio directory never wipes what is already there.
 *
 * Dummy files on disk carry no real audio bytes — `parseFile` is mocked, so
 * only the FILENAME (and its extension) matters to the scan.
 */

// Module-boundary mock: every import of `music-metadata` inside seed.ts
// resolves to this vi.fn(). The default resolves to an empty-tag payload so
// an unconfigured test degrades to filename fallbacks instead of crashing.
vi.mock('music-metadata', () => ({ parseFile: vi.fn() }));
const parseFileMock = vi.mocked(parseFile);

/** Minimal `common`/`format` payload shaped like music-metadata's result. */
function makeTags(commonOverrides: Record<string, unknown> = {}, duration?: number) {
  return {
    common: {
      artist: undefined,
      album: undefined,
      title: undefined,
      year: undefined,
      date: undefined,
      track: { no: null, of: null },
      ...commonOverrides,
    },
    format: { duration },
  };
}

/** Configure the boundary mock: map each absolute path to a tag payload. */
function stubTagsByPath(map: Record<string, Record<string, unknown>>, fallbackEmpty = true) {
  parseFileMock.mockImplementation(async (filePath: string) => {
    const key = filePath.split('/').pop() ?? filePath;
    const tags = map[key];
    if (tags) {
      const { duration, ...common } = tags;
      return makeTags(common, duration as number | undefined) as Awaited<
        ReturnType<typeof parseFile>
      >;
    }
    if (fallbackEmpty) return makeTags() as Awaited<ReturnType<typeof parseFile>>;
    throw new Error(`parseFile: unexpected path ${filePath}`);
  });
}

describe('prisma/seed — pure helpers', () => {
  describe('parseArtistTitleFromFilename (REQ: filename fallback)', () => {
    it('splits `Artist - Title.flac` on the FIRST ` - ` (artist left, title right without ext)', () => {
      expect(parseArtistTitleFromFilename('Gloria Gaynor - I Will Survive.flac')).toEqual({
        artist: 'Gloria Gaynor',
        title: 'I Will Survive',
      });
    });

    it('keeps later separators inside the title (`A - B - C.mp3` → artist A, title `B - C`)', () => {
      expect(parseArtistTitleFromFilename('A - B - C.mp3')).toEqual({
        artist: 'A',
        title: 'B - C',
      });
    });

    it('falls back to Unknown Artist when no separator exists', () => {
      expect(parseArtistTitleFromFilename('UntitledTrack.flac')).toEqual({
        artist: 'Unknown Artist',
        title: 'UntitledTrack',
      });
    });

    it('falls back to Unknown Artist when the left side trims to empty', () => {
      expect(parseArtistTitleFromFilename(' - Only Title.ogg')).toEqual({
        artist: 'Unknown Artist',
        title: 'Only Title',
      });
    });
  });

  describe('resolveDurationSeconds (REQ: 0-duration fallback is NOT acceptable)', () => {
    it('rounds a real duration', () => {
      expect(resolveDurationSeconds(296.1066666666667)).toBe(296);
    });

    it('floors sub-second durations to 1s (SPA progress divides by duration)', () => {
      expect(resolveDurationSeconds(0.4)).toBe(1);
    });

    it.each([
      ['undefined', undefined],
      ['zero', 0],
      ['negative', -12],
      ['NaN', Number.NaN],
      ['Infinity', Number.POSITIVE_INFINITY],
    ])('returns the 1s floor for %s', (_label, input) => {
      expect(resolveDurationSeconds(input)).toBe(1);
    });
  });

  describe('resolveYear', () => {
    it('prefers common.year', () => {
      expect(resolveYear(2019, '2020-01-01')).toBe(2019);
    });

    it('falls back to the first 4-digit run in common.date', () => {
      expect(resolveYear(undefined, '2019-08-09')).toBe(2019);
    });

    it('returns null when neither yields a plausible year', () => {
      expect(resolveYear(undefined, undefined)).toBeNull();
      expect(resolveYear(0, 'no-digits')).toBeNull();
    });
  });

  describe('deriveDeterministicId (UUID v5-style from SHA-256)', () => {
    it('produces RFC 4122 shape with version nibble 5 and variant 10xx', () => {
      const id = deriveDeterministicId('artist:Gloria Gaynor');
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    it('is stable across calls (equal key ⇒ equal UUID ⇒ idempotent re-seeds)', () => {
      expect(deriveDeterministicId('track:Artist - Title.flac')).toBe(
        deriveDeterministicId('track:Artist - Title.flac'),
      );
    });

    it('differs across keys (no cross-type collisions)', () => {
      const ids = new Set(
        ['artist:X', 'album:Y:X', 'track:X'].map((key) => deriveDeterministicId(key)),
      );
      expect(ids.size).toBe(3);
    });
  });

  describe('resolveTrackMeta (tag + fallback merge)', () => {
    it('uses parsed tags when present', () => {
      const meta = resolveTrackMeta('anything.flac', {
        artist: 'Gloria Gaynor',
        album: 'Love Tracks',
        title: 'I Will Survive',
        year: 2019,
        trackNo: 5,
        duration: 296.1,
      });
      expect(meta).toEqual({
        artist: 'Gloria Gaynor',
        album: 'Love Tracks',
        title: 'I Will Survive',
        year: 2019,
        trackNo: 5,
        durationSeconds: 296,
      });
    });

    it('derives artist/title from the filename and album from the Singles constant when tags are absent', () => {
      const meta = resolveTrackMeta('Kendrick Lamar - tv off.flac', {});
      expect(meta).toEqual({
        artist: 'Kendrick Lamar',
        album: 'Singles',
        title: 'tv off',
        year: null,
        trackNo: null,
        durationSeconds: 1,
      });
    });

    it('rejects non-positive / fractional track numbers to null', () => {
      expect(resolveTrackMeta('A - B.flac', { trackNo: 0 }).trackNo).toBeNull();
      expect(resolveTrackMeta('A - B.flac', { trackNo: -3 }).trackNo).toBeNull();
      expect(resolveTrackMeta('A - B.flac', { trackNo: 2.5 }).trackNo).toBeNull();
      expect(resolveTrackMeta('A - B.flac', { trackNo: null }).trackNo).toBeNull();
    });

    it('treats whitespace-only tags as missing (falls back to filename)', () => {
      const meta = resolveTrackMeta('Jfarrari - The Unknowing.flac', {
        artist: '   ',
        title: '',
      });
      expect(meta.artist).toBe('Jfarrari');
      expect(meta.title).toBe('The Unknowing');
    });
  });

  describe('isAudioFile / AUDIO_EXTENSIONS', () => {
    it('accepts the six pinned extensions case-insensitively and rejects others', () => {
      expect(AUDIO_EXTENSIONS).toEqual(['.mp3', '.flac', '.ogg', '.m4a', '.wav', '.opus']);
      expect(isAudioFile('A - B.FLAC')).toBe(true);
      expect(isAudioFile('A - B.Mp3')).toBe(true);
      expect(isAudioFile('A - B.txt')).toBe(false);
      expect(isAudioFile('noext')).toBe(false);
    });
  });

  describe('buildCatalog (grouping + ids + ordering)', () => {
    const files: ScannedAudioFile[] = [
      // Out-of-order track numbers within one album + one untagged file.
      {
        relativePath: 'Artist A - Second.flac',
        meta: {
          artist: 'Artist A',
          album: 'Album X',
          title: 'Second',
          year: null,
          trackNo: 2,
          durationSeconds: 200,
        },
      },
      {
        relativePath: 'Artist A - First.flac',
        meta: {
          artist: 'Artist A',
          album: 'Album X',
          title: 'First',
          year: 2001,
          trackNo: 1,
          durationSeconds: 100,
        },
      },
      {
        relativePath: 'Artist A - Untagged.flac',
        meta: {
          artist: 'Artist A',
          album: 'Album X',
          title: 'Untagged',
          year: null,
          trackNo: null,
          durationSeconds: 1,
        },
      },
      {
        relativePath: 'Artist B - Solo.flac',
        meta: {
          artist: 'Artist B',
          album: 'Singles',
          title: 'Solo',
          year: 1999,
          trackNo: null,
          durationSeconds: 42,
        },
      },
    ];

    it('groups artists → albums per artist by title and orders tracks by track.no then filename', () => {
      const catalog = buildCatalog(files);

      expect(catalog.artists.map((a) => a.name)).toEqual(['Artist A', 'Artist B']);
      expect(catalog.albums.map((a) => a.title)).toEqual(['Album X', 'Singles']);

      const albumXTracks = catalog.tracks.filter((t) => t.album_id === catalog.albums[0]!.id);
      // track.no 1, 2, then the untagged file last by filename.
      expect(albumXTracks.map((t) => t.title)).toEqual(['First', 'Second', 'Untagged']);
      // Untagged file gets the 1-based position as its track_number (NOT NULL).
      expect(albumXTracks.map((t) => t.track_number)).toEqual([1, 2, 3]);
    });

    it('stores file_path rooted at /audio/ per the FsAudioStorage.resolve contract', () => {
      const catalog = buildCatalog(files);
      const byTitle = new Map(catalog.tracks.map((t) => [t.title, t]));
      expect(byTitle.get('Solo')!.file_path).toBe('/audio/Artist B - Solo.flac');
    });

    it('takes the album release_year from the first non-null track year', () => {
      const catalog = buildCatalog(files);
      // Album X: only "First" carries a year (2001) — later untagged files
      // must not clobber it, and null-year files must not zero it out.
      expect(catalog.albums.find((a) => a.title === 'Album X')!.release_year).toBe(2001);
      expect(catalog.albums.find((a) => a.title === 'Singles')!.release_year).toBe(1999);
    });

    it('derives ids from the stable keys (artist/album/track) — stable across runs', () => {
      const first = buildCatalog(files);
      const second = buildCatalog([...files].reverse());
      // Reversed input MUST NOT change ids, ordering, or any column: the
      // builder sorts by relativePath internally.
      expect(second).toEqual(first);
      expect(first.tracks[0]!.id).toBe(deriveDeterministicId('track:Artist A - First.flac'));
      expect(first.artists[0]!.id).toBe(deriveDeterministicId('artist:Artist A'));
      expect(first.albums[0]!.id).toBe(
        deriveDeterministicId(`album:${first.artists[0]!.id}:Album X`),
      );
    });
  });
});

describe('prisma/seed — runSeed integration (PG16 testcontainer)', () => {
  let db: TestDbContext;
  let audioRoot: string;

  // hookTimeout bumped to 60s — under full-suite parallelism (catalog +
  // playback + playlists e2e + integration specs all booting Postgres 16
  // testcontainers concurrently) the default 10s beforeAll can race the
  // container-start. Mirrors the playlists integration-spec bump (79abadf).
  beforeAll(async () => {
    db = await startTestDb();
    audioRoot = await fs.mkdtemp(join(tmpdir(), 'seed-audio-'));
  }, 60_000);

  afterAll(async () => {
    await db.cleanup();
    await fs.rm(audioRoot, { recursive: true, force: true });
  });

  beforeEach(async () => {
    parseFileMock.mockReset();
    await db.truncate();
    await fs.rm(audioRoot, { recursive: true, force: true });
    await fs.mkdir(audioRoot, { recursive: true });
  });

  afterEach(() => {
    parseFileMock.mockReset();
  });

  /** Write empty dummy files — only names matter (parseFile is mocked). */
  async function writeFiles(names: string[]): Promise<void> {
    for (const name of names) {
      await fs.writeFile(join(audioRoot, name), Buffer.alloc(0));
    }
  }

  it('seeds a non-empty catalog from scanned files with tags', async () => {
    await writeFiles(['Artist A - First.flac', 'Artist A - Second.flac', 'Artist B - Other.mp3']);
    stubTagsByPath({
      'Artist A - First.flac': { artist: 'Artist A', album: 'Album X', trackNo: 1 },
      'Artist A - Second.flac': { artist: 'Artist A', album: 'Album X', trackNo: 2 },
      'Artist B - Other.mp3': { artist: 'Artist B', album: 'Album Y', trackNo: 7 },
    });

    await runSeed(db.prisma, audioRoot);

    const snapshot = await snapshotCatalog(db);
    expect(snapshot.artists).toHaveLength(2);
    expect(snapshot.albums).toHaveLength(2);
    expect(snapshot.tracks).toHaveLength(3);
    // Untitled tags fall back to the filename's title side.
    expect(snapshot.tracks.map((t) => t.title).sort()).toEqual(['First', 'Other', 'Second']);
    // file_path stored rooted at /audio/ for FsAudioStorage.resolve.
    expect(snapshot.tracks.every((t) => t.file_path.startsWith('/audio/'))).toBe(true);
  });

  it('is row-idempotent: two runs without truncating produce a byte-identical snapshot', async () => {
    await writeFiles(['Artist A - First.flac', 'Artist B - Other.flac']);
    stubTagsByPath({
      'Artist A - First.flac': { artist: 'Artist A', duration: 180.9 },
      'Artist B - Other.flac': { artist: 'Artist B', duration: 42.4 },
    });

    await runSeed(db.prisma, audioRoot);
    const first = await snapshotCatalog(db);

    await runSeed(db.prisma, audioRoot);
    const second = await snapshotCatalog(db);

    expect(second.artists).toEqual(first.artists);
    expect(second.albums).toEqual(first.albums);
    expect(second.tracks).toEqual(first.tracks);
  });

  it('syncs incremental changes: a changed tag UPDATES the existing row (no duplicate)', async () => {
    await writeFiles(['Artist A - First.flac']);
    stubTagsByPath({
      'Artist A - First.flac': { artist: 'Artist A', title: 'Original', duration: 100 },
    });
    await runSeed(db.prisma, audioRoot);

    // Same file, retagged (new title + duration).
    stubTagsByPath({
      'Artist A - First.flac': { artist: 'Artist A', title: 'Retitled', duration: 254.6 },
    });
    await runSeed(db.prisma, audioRoot);

    const snapshot = await snapshotCatalog(db);
    expect(snapshot.tracks).toHaveLength(1);
    expect(snapshot.tracks[0]).toMatchObject({
      title: 'Retitled',
      duration_seconds: 255, // Math.round(254.6)
      file_path: '/audio/Artist A - First.flac',
    });
  });

  it('degrades to filename fallbacks when parseFile rejects (file stays in the catalog)', async () => {
    await writeFiles(['Kendrick Lamar - tv off.flac']);
    stubTagsByPath({}, /* fallbackEmpty */ false); // every parse throws

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await runSeed(db.prisma, audioRoot);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }

    const snapshot = await snapshotCatalog(db);
    expect(snapshot.tracks).toHaveLength(1);
    expect(snapshot.tracks[0]).toMatchObject({
      title: 'tv off',
      duration_seconds: 1, // the 1s floor — 0 is NOT acceptable
    });
    expect(snapshot.albums[0]!.title).toBe('Singles');
  });

  it('NO-OPs with a warning on an empty audio dir — existing rows untouched', async () => {
    await writeFiles(['Artist A - First.flac']);
    stubTagsByPath({ 'Artist A - First.flac': { artist: 'Artist A' } });
    await runSeed(db.prisma, audioRoot);
    const before = await snapshotCatalog(db);
    expect(before.tracks).toHaveLength(1);

    // Empty the dir (no files removed from the DB — the seeder must not wipe).
    await fs.rm(join(audioRoot, 'Artist A - First.flac'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await runSeed(db.prisma, audioRoot);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }

    const after = await snapshotCatalog(db);
    expect(after).toEqual(before);
  });

  it('NO-OPs with a warning on a missing audio dir (never wipes)', async () => {
    await writeFiles(['Artist A - First.flac']);
    stubTagsByPath({ 'Artist A - First.flac': { artist: 'Artist A' } });
    await runSeed(db.prisma, audioRoot);
    const before = await snapshotCatalog(db);

    const missingRoot = join(audioRoot, 'does-not-exist');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await runSeed(db.prisma, missingRoot);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }

    expect(await snapshotCatalog(db)).toEqual(before);
  });

  it('uses UUID v5 identifiers (version nibble = 5) for every row', async () => {
    await writeFiles(['Artist A - First.flac', 'Artist B - Other.flac']);
    stubTagsByPath({
      'Artist A - First.flac': { artist: 'Artist A' },
      'Artist B - Other.flac': { artist: 'Artist B' },
    });
    await runSeed(db.prisma, audioRoot);

    const snapshot = await snapshotCatalog(db);
    const allIds = [
      ...snapshot.artists.map((a) => a.id),
      ...snapshot.albums.map((a) => a.id),
      ...snapshot.tracks.map((t) => t.id),
    ];
    expect(allIds.length).toBeGreaterThan(0);
    for (const id of allIds) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
  });
});

/**
 * Snapshot every catalog row in a stable order so two seed runs can be
 * compared structurally (`created_at`-then-`id` — deterministic under the
 * seed's single-transaction insert order).
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
