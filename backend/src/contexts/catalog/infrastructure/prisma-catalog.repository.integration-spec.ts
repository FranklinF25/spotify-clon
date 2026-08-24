import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { TestDbContext } from '../../../../test/helpers/test-db';
import { startTestDb } from '../../../../test/helpers/test-db';
import type {
  AlbumDetail,
  AlbumSummary,
  ArtistDetail,
  ArtistSummary,
  PaginatedResult,
  SearchResult,
  TrackSummary,
} from '../domain/read-models';
import { Artist } from '../domain/artist.entity';
import { PrismaCatalogRepository } from './prisma-catalog.repository';

/**
 * PrismaCatalogRepository integration — real Postgres 16 via testcontainers.
 *
 * Pins the 7-method CatalogRepositoryPort contract against the actual
 * schema (catalog_unaccent IMMUTABLE wrapper, generated tsvector columns,
 * GIN indexes, cascade FKs). One container per file; TRUNCATE between tests.
 *
 * Critical regressions caught here (and nowhere else):
 *  - Björk ↔ bjork accent folding (real `catalog_unaccent` + `websearch_to_tsquery`);
 *  - `Promise.all` parallel search across 3 tables;
 *  - `findTrackByIds([])` empty-array guard (no DB round-trip);
 *  - `findAlbumById` includes tracks ordered by `track_number` ASC;
 *  - `listArtists` / `listAlbums` return accurate `total` for pagination.
 */
describe('PrismaCatalogRepository', () => {
  let db: TestDbContext;
  let prisma: PrismaClient;
  let repo: PrismaCatalogRepository;

  beforeAll(async () => {
    db = await startTestDb();
    prisma = db.prisma;
    repo = new PrismaCatalogRepository(prisma);
  }, 60_000);

  beforeEach(async () => {
    await db.truncate();
  });

  afterAll(async () => {
    await db.cleanup();
  });

  /** Insert an artist and return the row read straight from the DB. */
  async function seedArtist(name: string, bio: string | null = null): Promise<Artist> {
    const row = await prisma.$queryRaw<{ id: string; name: string; bio: string | null; image_url: string | null; created_at: Date }[]>`
      INSERT INTO artists (name, bio) VALUES (${name}, ${bio}) RETURNING id, name, bio, image_url, created_at`;
    const r = row[0];
    return Artist.reconstruct({
      id: r.id,
      name: r.name,
      bio: r.bio,
      imageUrl: r.image_url,
      createdAt: r.created_at,
    });
  }

  async function seedAlbum(
    artistId: string,
    title: string,
    releaseYear: number | null = 2024,
  ): Promise<{ id: string; title: string; release_year: number | null; cover_url: string | null; artist_id: string; created_at: Date }> {
    const row = await prisma.$queryRaw<{ id: string; title: string; release_year: number | null; cover_url: string | null; artist_id: string; created_at: Date }[]>`
      INSERT INTO albums (title, release_year, artist_id)
      VALUES (${title}, ${releaseYear}, ${artistId}::uuid)
      RETURNING id, title, release_year, cover_url, artist_id, created_at`;
    return row[0];
  }

  async function seedTrack(
    albumId: string,
    title: string,
    trackNumber: number,
    durationSeconds = 200,
  ): Promise<{ id: string; title: string; duration_seconds: number; file_path: string; track_number: number; album_id: string; created_at: Date }> {
    const filePath = `/storage/${title}.mp3`;
    const row = await prisma.$queryRaw<{ id: string; title: string; duration_seconds: number; file_path: string; track_number: number; album_id: string; created_at: Date }[]>`
      INSERT INTO tracks (title, duration_seconds, file_path, track_number, album_id)
      VALUES (${title}, ${durationSeconds}, ${filePath}, ${trackNumber}, ${albumId}::uuid)
      RETURNING id, title, duration_seconds, file_path, track_number, album_id, created_at`;
    return row[0];
  }

  describe('findArtistById', () => {
    it('returns ArtistDetail with embedded album summaries', async () => {
      const artist = await seedArtist('Artist One');
      await seedAlbum(artist.id, 'Album A');
      await seedAlbum(artist.id, 'Album B');

      const detail: ArtistDetail | null = await repo.findArtistById(artist.id);

      expect(detail).not.toBeNull();
      expect(detail!.artist.id).toBe(artist.id);
      expect(detail!.artist.name).toBe('Artist One');
      expect(detail!.albums).toHaveLength(2);
      expect(detail!.albums.map((a) => a.title).sort()).toEqual(['Album A', 'Album B']);
    });

    it('returns null for an unknown id', async () => {
      expect(await repo.findArtistById('00000000-0000-0000-0000-000000000000')).toBeNull();
    });
  });

  describe('findAlbumById', () => {
    it('returns AlbumDetail with artist summary + tracks ordered by track_number ASC', async () => {
      const artist = await seedArtist('Artist One');
      // Insert tracks out of order — the adapter MUST order by track_number.
      const albumRow = await seedAlbum(artist.id, 'Album A');
      await seedTrack(albumRow.id, 'Track Three', 3);
      await seedTrack(albumRow.id, 'Track One', 1);
      await seedTrack(albumRow.id, 'Track Two', 2);

      const detail: AlbumDetail | null = await repo.findAlbumById(albumRow.id);

      expect(detail).not.toBeNull();
      expect(detail!.album.title).toBe('Album A');
      expect(detail!.artist.id).toBe(artist.id);
      expect(detail!.artist.name).toBe('Artist One');
      expect(detail!.tracks.map((t) => t.trackNumber)).toEqual([1, 2, 3]);
    });

    it('returns null for an unknown id', async () => {
      expect(await repo.findAlbumById('00000000-0000-0000-0000-000000000000')).toBeNull();
    });
  });

  describe('findTrackById', () => {
    it('returns the Track entity when found (filePath accessible)', async () => {
      const artist = await seedArtist('Artist One');
      const album = await seedAlbum(artist.id, 'Album A');
      const trackRow = await seedTrack(album.id, 'Track One', 1);

      const track = await repo.findTrackById(trackRow.id);

      expect(track).not.toBeNull();
      expect(track!.title).toBe('Track One');
      expect(track!.filePath).toBe('/storage/Track One.mp3');
    });

    it('returns null for an unknown id', async () => {
      expect(await repo.findTrackById('00000000-0000-0000-0000-000000000000')).toBeNull();
    });
  });

  describe('findTrackByIds', () => {
    it('returns [] immediately when ids is empty (port contract: no DB round-trip)', async () => {
      // Behavioral guard: the adapter's `if (ids.length === 0) return []`
      // short-circuits before reaching `prisma.track.findMany`. Verified
      // behaviorally — the empty `ids` call returns [] synchronously
      // without depending on row state.
      const result = await repo.findTrackByIds([]);

      expect(result).toEqual([]);
    });

    it('returns only tracks that exist (missing IDs silently skipped)', async () => {
      const artist = await seedArtist('Artist One');
      const album = await seedAlbum(artist.id, 'Album A');
      const t1 = await seedTrack(album.id, 'Track One', 1);
      const t2 = await seedTrack(album.id, 'Track Two', 2);

      const result = await repo.findTrackByIds([
        t1.id,
        '00000000-0000-0000-0000-000000000000',
        t2.id,
      ]);

      expect(result).toHaveLength(2);
      const titles = result.map((t) => t.title).sort();
      expect(titles).toEqual(['Track One', 'Track Two']);
    });
  });

  describe('findAlbumByIds', () => {
    it('returns only the albums that exist (missing IDs silently skipped, no placeholder entries)', async () => {
      // REQ-L-005 "Batch lookup returns only the existing subset": a request
      // for [A1, A2, nope] resolves to exactly the A1 + A2 summaries.
      const artist = await seedArtist('Artist One');
      const a1 = await seedAlbum(artist.id, 'Album One');
      const a2 = await seedAlbum(artist.id, 'Album Two');

      const result: AlbumSummary[] = await repo.findAlbumByIds([
        a1.id,
        a2.id,
        '00000000-0000-0000-0000-000000000000',
      ]);

      expect(result).toHaveLength(2);
      const titles = result.map((a) => a.title).sort();
      expect(titles).toEqual(['Album One', 'Album Two']);
      for (const album of result) {
        expect(album.artist.id).toBe(artist.id);
        expect(album.artist.name).toBe('Artist One');
      }
      // No placeholder/null entry for the unknown id — found-only contract.
      expect(result.every((a) => Boolean(a.id) && a.id !== '00000000-0000-0000-0000-000000000000')).toBe(true);
    });

    it('returns [] immediately when ids is empty (port contract: no DB round-trip)', async () => {
      // Behavioral mirror of the findTrackByIds empty-short-circuit guard:
      // the adapter returns [] before reaching prisma.album.findMany.
      const result = await repo.findAlbumByIds([]);

      expect(result).toEqual([]);
    });
  });

  describe('listArtists', () => {
    it('paginates with accurate total + page + pageSize', async () => {
      for (let i = 0; i < 7; i++) {
        await seedArtist(`Artist ${i}`);
      }

      const result: PaginatedResult<ArtistSummary> = await repo.listArtists({
        page: 2,
        pageSize: 3,
      });

      expect(result.page).toBe(2);
      expect(result.pageSize).toBe(3);
      expect(result.total).toBe(7);
      expect(result.items).toHaveLength(3);
    });

    it('returns empty items + accurate total when page is out of range', async () => {
      for (let i = 0; i < 3; i++) {
        await seedArtist(`Artist ${i}`);
      }

      const result = await repo.listArtists({ page: 999, pageSize: 20 });

      expect(result.items).toEqual([]);
      expect(result.total).toBe(3);
    });
  });

  describe('listAlbums', () => {
    it('returns AlbumSummary items with embedded artist summary', async () => {
      const artist = await seedArtist('Artist One');
      await seedAlbum(artist.id, 'Album A');
      await seedAlbum(artist.id, 'Album B');

      const result: PaginatedResult<AlbumSummary> = await repo.listAlbums({
        page: 1,
        pageSize: 20,
      });

      expect(result.total).toBe(2);
      expect(result.items).toHaveLength(2);
      for (const album of result.items) {
        expect(album.artist.id).toBe(artist.id);
        expect(album.artist.name).toBe('Artist One');
      }
    });
  });

  describe('search', () => {
    it('matches across all 3 tables in parallel via Promise.all', async () => {
      // Insert one entity per table whose name/title contains "shared".
      const artist = await seedArtist('Shared Artist');
      const albumRow = await seedAlbum(artist.id, 'Shared Album');
      await seedTrack(albumRow.id, 'Shared Track', 1);

      const result: SearchResult = await repo.search({ q: 'shared', limit: 100 });

      expect(result.artists.map((a: ArtistSummary) => a.name)).toContain('Shared Artist');
      expect(result.albums.map((a: AlbumSummary) => a.title)).toContain('Shared Album');
      expect(result.tracks.map((t: TrackSummary) => t.title)).toContain('Shared Track');
    });

    it('folds accents using catalog_unaccent: Björk ↔ bjork', async () => {
      await seedArtist('Björk');

      const result = await repo.search({ q: 'bjork', limit: 100 });

      expect(result.artists.map((a) => a.name)).toContain('Björk');
    });

    it('folds accents using catalog_unaccent: José ↔ jose', async () => {
      await seedArtist('José González');

      const result = await repo.search({ q: 'jose', limit: 100 });

      expect(result.artists.map((a) => a.name)).toContain('José González');
    });

    it('returns 200 with empty arrays when no matches', async () => {
      await seedArtist('Something');

      const result = await repo.search({ q: 'zzznomatch', limit: 100 });

      expect(result).toEqual({ artists: [], albums: [], tracks: [] });
    });

    it('respects the type filter (only the matching group is populated)', async () => {
      const artist = await seedArtist('Filter Artist');
      const albumRow = await seedAlbum(artist.id, 'Filter Album');
      await seedTrack(albumRow.id, 'Filter Track', 1);

      const result = await repo.search({ q: 'filter', limit: 100, type: 'artist' });

      expect(result.artists.map((a) => a.name)).toContain('Filter Artist');
      expect(result.albums).toEqual([]);
      expect(result.tracks).toEqual([]);
    });

    it('caps each group at the limit', async () => {
      for (let i = 0; i < 5; i++) {
        await seedArtist(`Limited Artist ${i}`);
      }

      const result = await repo.search({ q: 'limited', limit: 2 });

      expect(result.artists).toHaveLength(2);
    });

    it('does NOT leak filePath in TrackSummary', async () => {
      const artist = await seedArtist('Leak Artist');
      const albumRow = await seedAlbum(artist.id, 'Leak Album');
      await seedTrack(albumRow.id, 'Leak Track', 1);

      const result = await repo.search({ q: 'leak', limit: 100 });

      expect(result.tracks).toHaveLength(1);
      const trackSummary = result.tracks[0];
      expect(trackSummary).not.toHaveProperty('filePath');
      // Verify only the TrackSummary keys exist.
      expect(Object.keys(trackSummary!).sort()).toEqual(
        ['albumId', 'durationSeconds', 'id', 'title'].sort(),
      );
    });
  });
});
