import type { PrismaClient } from '@prisma/client';

import type {
  CatalogEntryInput,
  CatalogRepositoryPort,
  ListInput,
  SearchInput,
} from '../domain/ports/catalog-repository.port';
import type {
  AlbumDetail,
  AlbumSummary,
  ArtistDetail,
  ArtistSummary,
  PaginatedResult,
  SearchResult,
  TrackSummary,
} from '../domain/read-models';
import { Album } from '../domain/album.entity';
import { Artist } from '../domain/artist.entity';
import { Track } from '../domain/track.entity';

/**
 * Prisma-backed `CatalogRepositoryPort` (CAT-PR2b1-04).
 *
 * Plain class (no `@Injectable`) — wired through `useClass` in
 * `CatalogModule` so it stays constructible and testable without a Nest
 * `TestingModule`. `PrismaClient` is constructor-injected (provided
 * globally by `PrismaModule`).
 *
 * Single-round-trip compound reads:
 *  - `findArtistById` — `include: { albums: { orderBy: { createdAt: 'asc' } } }`;
 *  - `findAlbumById` — `include: { artist: true, tracks: { orderBy: { trackNumber: 'asc' } } }`.
 *
 * `findTrackByIds` honours the port contract: empty input → `[]` WITHOUT a
 * DB round-trip (playback queue resolution depends on this).
 *
 * `search` issues 3 `$queryRaw` SELECTs in parallel via `Promise.all`
 * (serializing would triple p95 for no reason). The generated tsvector
 * columns (`name_tsv`, `title_tsv`) were built with `catalog_unaccent(...)`
 * (the IMMUTABLE wrapper around `public.unaccent` — see migration
 * `0001_catalog`), so the query side MUST call `catalog_unaccent($1)` too.
 * Using `public.unaccent` directly would NOT match the indexed columns.
 *
 * `upsertCatalogEntry` (REQ-UPLOAD-002) is the port's first WRITE — three
 * raw `ON CONFLICT ("id") DO UPDATE` statements in one `$transaction`,
 * mirroring the seeder's sync semantics (see the method docstring).
 */
export class PrismaCatalogRepository implements CatalogRepositoryPort {
  constructor(private readonly prisma: PrismaClient) {}

  async findArtistById(id: string): Promise<ArtistDetail | null> {
    const row = await this.prisma.artist.findUnique({
      where: { id },
      include: {
        albums: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!row) return null;
    const artist = toArtist(row);
    const albums: AlbumSummary[] = row.albums.map((a) => ({
      id: a.id,
      title: a.title,
      releaseYear: a.releaseYear,
      coverUrl: a.coverUrl,
      artist: artist.toSummary(),
    }));
    return { artist, albums };
  }

  async findAlbumById(id: string): Promise<AlbumDetail | null> {
    const row = await this.prisma.album.findUnique({
      where: { id },
      include: {
        artist: true,
        tracks: { orderBy: { trackNumber: 'asc' } },
      },
    });
    if (!row) return null;
    const album = toAlbum(row);
    const artist: ArtistSummary = { id: row.artist.id, name: row.artist.name };
    const tracks = row.tracks.map((t) => toTrack(t));
    return { album, artist, tracks };
  }

  async findTrackById(id: string): Promise<Track | null> {
    const row = await this.prisma.track.findUnique({ where: { id } });
    return row ? toTrack(row) : null;
  }

  async findTrackByIds(ids: readonly string[]): Promise<Track[]> {
    // Port contract: empty input → no DB round-trip (R3-W-4).
    if (ids.length === 0) return [];
    const rows = await this.prisma.track.findMany({
      where: { id: { in: [...ids] } },
    });
    return rows.map(toTrack);
  }

  async findAlbumByIds(ids: readonly string[]): Promise<AlbumSummary[]> {
    // Port contract (REQ-L-005): empty input → no DB round-trip; missing IDs
    // are silently skipped; result order is NOT guaranteed (caller sorts).
    if (ids.length === 0) return [];
    const rows = await this.prisma.album.findMany({
      where: { id: { in: [...ids] } },
      include: { artist: true },
    });
    return rows.map((a) => ({
      id: a.id,
      title: a.title,
      releaseYear: a.releaseYear,
      coverUrl: a.coverUrl,
      artist: { id: a.artist.id, name: a.artist.name },
    }));
  }

  async listArtists(input: ListInput): Promise<PaginatedResult<ArtistSummary>> {
    const [rows, total] = await Promise.all([
      this.prisma.artist.findMany({
        orderBy: { createdAt: 'asc' },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      this.prisma.artist.count(),
    ]);
    return {
      items: rows.map((a) => ({ id: a.id, name: a.name })),
      page: input.page,
      pageSize: input.pageSize,
      total,
    };
  }

  async listAlbums(input: ListInput): Promise<PaginatedResult<AlbumSummary>> {
    const [rows, total] = await Promise.all([
      this.prisma.album.findMany({
        orderBy: { createdAt: 'asc' },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        include: { artist: true },
      }),
      this.prisma.album.count(),
    ]);
    return {
      items: rows.map((a) => ({
        id: a.id,
        title: a.title,
        releaseYear: a.releaseYear,
        coverUrl: a.coverUrl,
        artist: { id: a.artist.id, name: a.artist.name },
      })),
      page: input.page,
      pageSize: input.pageSize,
      total,
    };
  }

  async search(input: SearchInput): Promise<SearchResult> {
    // 3 SELECTs in parallel via Promise.all (serializing triples p95 for no
    // reason). `$queryRaw` parameterizes `q` and `limit` — no string
    // interpolation, no SQL-injection surface.
    const [artists, albums, tracks] = await Promise.all([
      input.type && input.type !== 'artist'
        ? Promise.resolve([])
        : this.searchArtists(input.q, input.limit),
      input.type && input.type !== 'album'
        ? Promise.resolve([])
        : this.searchAlbums(input.q, input.limit),
      input.type && input.type !== 'track'
        ? Promise.resolve([])
        : this.searchTracks(input.q, input.limit),
    ]);
    return { artists, albums, tracks };
  }

  private async searchArtists(q: string, limit: number): Promise<ArtistSummary[]> {
    const rows = await this.prisma.$queryRaw<ArtistRow[]>`
      SELECT id, name FROM artists
      WHERE name_tsv @@ websearch_to_tsquery('simple', catalog_unaccent(${q}))
      ORDER BY ts_rank(name_tsv, websearch_to_tsquery('simple', catalog_unaccent(${q}))) DESC,
               created_at DESC
      LIMIT ${limit}`;
    return rows.map((r) => ({ id: r.id, name: r.name }));
  }

  private async searchAlbums(q: string, limit: number): Promise<AlbumSummary[]> {
    const rows = await this.prisma.$queryRaw<AlbumRow[]>`
      SELECT a.id, a.title, a.release_year, a.cover_url,
             ar.id AS artist_id, ar.name AS artist_name
      FROM albums a JOIN artists ar ON ar.id = a.artist_id
      WHERE a.title_tsv @@ websearch_to_tsquery('simple', catalog_unaccent(${q}))
      ORDER BY ts_rank(a.title_tsv, websearch_to_tsquery('simple', catalog_unaccent(${q}))) DESC,
               a.created_at DESC
      LIMIT ${limit}`;
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      releaseYear: r.release_year,
      coverUrl: r.cover_url,
      artist: { id: r.artist_id, name: r.artist_name },
    }));
  }

  private async searchTracks(q: string, limit: number): Promise<TrackSummary[]> {
    const rows = await this.prisma.$queryRaw<TrackRow[]>`
      SELECT id, title, duration_seconds, album_id FROM tracks
      WHERE title_tsv @@ websearch_to_tsquery('simple', catalog_unaccent(${q}))
      ORDER BY ts_rank(title_tsv, websearch_to_tsquery('simple', catalog_unaccent(${q}))) DESC,
               created_at DESC
      LIMIT ${limit}`;
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      durationSeconds: r.duration_seconds,
      albumId: r.album_id,
    }));
  }

  async upsertCatalogEntry(entry: CatalogEntryInput): Promise<void> {
    // REQ-UPLOAD-002 — the port's first WRITE. Raw `ON CONFLICT ("id") DO
    // UPDATE` statements mirror `prisma/seed.ts` `runSeed` VERBATIM (same
    // column lists, same EXCLUDED bindings) so an upload and a re-seed are
    // interchangeable writers to the same rows. All three statements run in
    // ONE `$transaction`: a partial write (track row without its album)
    // must never be observable. Artists before albums before tracks — the
    // FK dependency order. bio/image_url/cover_url are not uploadable and
    // bind NULL on both insert and update (seed parity: a re-seed resets
    // them to NULL too).
    await this.prisma.$transaction([
      this.prisma.$executeRaw`
        INSERT INTO "artists" ("id", "name", "bio", "image_url")
        VALUES (${entry.artist.id}::uuid, ${entry.artist.name}, NULL, NULL)
        ON CONFLICT ("id") DO UPDATE SET
          "name" = EXCLUDED."name",
          "bio" = EXCLUDED."bio",
          "image_url" = EXCLUDED."image_url"
      `,
      this.prisma.$executeRaw`
        INSERT INTO "albums" ("id", "title", "release_year", "cover_url", "artist_id")
        VALUES (${entry.album.id}::uuid, ${entry.album.title}, ${entry.album.releaseYear}, NULL, ${entry.album.artistId}::uuid)
        ON CONFLICT ("id") DO UPDATE SET
          "title" = EXCLUDED."title",
          "release_year" = EXCLUDED."release_year",
          "cover_url" = EXCLUDED."cover_url",
          "artist_id" = EXCLUDED."artist_id"
      `,
      this.prisma.$executeRaw`
        INSERT INTO "tracks" ("id", "title", "duration_seconds", "file_path", "track_number", "album_id")
        VALUES (${entry.track.id}::uuid, ${entry.track.title}, ${entry.track.durationSeconds}, ${entry.track.filePath}, ${entry.track.trackNumber}, ${entry.track.albumId}::uuid)
        ON CONFLICT ("id") DO UPDATE SET
          "title" = EXCLUDED."title",
          "duration_seconds" = EXCLUDED."duration_seconds",
          "file_path" = EXCLUDED."file_path",
          "track_number" = EXCLUDED."track_number",
          "album_id" = EXCLUDED."album_id"
      `,
    ]);
  }
}

// ---------------------------------------------------------------------------
// Mappers — Prisma row → domain entity. No re-validation (DB is trusted).
// ---------------------------------------------------------------------------

function toArtist(row: {
  id: string;
  name: string;
  bio: string | null;
  imageUrl: string | null;
  createdAt: Date;
}): Artist {
  return Artist.reconstruct({
    id: row.id,
    name: row.name,
    bio: row.bio,
    imageUrl: row.imageUrl,
    createdAt: row.createdAt,
  });
}

function toAlbum(row: {
  id: string;
  title: string;
  releaseYear: number | null;
  coverUrl: string | null;
  artistId: string;
  createdAt: Date;
}): Album {
  return Album.reconstruct({
    id: row.id,
    title: row.title,
    releaseYear: row.releaseYear,
    coverUrl: row.coverUrl,
    artistId: row.artistId,
    createdAt: row.createdAt,
  });
}

function toTrack(row: {
  id: string;
  title: string;
  durationSeconds: number;
  filePath: string;
  trackNumber: number;
  albumId: string;
  createdAt: Date;
}): Track {
  return Track.reconstruct({
    id: row.id,
    title: row.title,
    durationSeconds: row.durationSeconds,
    filePath: row.filePath,
    trackNumber: row.trackNumber,
    albumId: row.albumId,
    createdAt: row.createdAt,
  });
}

interface ArtistRow {
  id: string;
  name: string;
}

interface AlbumRow {
  id: string;
  title: string;
  release_year: number | null;
  cover_url: string | null;
  artist_id: string;
  artist_name: string;
}

interface TrackRow {
  id: string;
  title: string;
  duration_seconds: number;
  album_id: string;
}
