import type {
  CatalogRepositoryPort,
  ListInput,
  SearchInput,
} from '../src/contexts/catalog/domain/ports/catalog-repository.port';
import type {
  AlbumDetail,
  AlbumSummary,
  ArtistDetail,
  ArtistSummary,
  PaginatedResult,
  SearchResult,
  TrackSummary,
} from '../src/contexts/catalog/domain/read-models';
import { Album } from '../src/contexts/catalog/domain/album.entity';
import { Artist } from '../src/contexts/catalog/domain/artist.entity';
import { Track } from '../src/contexts/catalog/domain/track.entity';

/**
 * Hand-written in-memory fake for the catalog use-case specs (CAT-PR2a-07).
 *
 * Mirrors identity's fakes (`identity-fakes.ts`): implements the
 * `CatalogRepositoryPort` interface against simple arrays so the application
 * layer stays framework-agnostic and testable without Prisma or NestJS.
 *
 * Doubles as a LIVING CONSUMER of the port — signature drift surfaces as a
 * typecheck error here first (before any spec runs).
 *
 * `search` does a case-insensitive substring match on name/title. This is
 * good enough for unit specs; the real tsvector behaviour (Björk ↔ bjork,
 * ranking) is verified in the PR-3c integration spec, NOT here.
 */

/** Deterministic epoch used by fixture builders so snapshots are stable. */
const EPOCH = new Date('2025-01-01T00:00:00.000Z');

export class InMemoryCatalogRepository implements CatalogRepositoryPort {
  public readonly artists: Artist[] = [];
  public readonly albums: Album[] = [];
  public readonly tracks: Track[] = [];

  /** Helper to seed the fake from a spec (push-through, mirrors identity fakes). */
  seed(input: { artists?: Artist[]; albums?: Album[]; tracks?: Track[] }): this {
    if (input.artists) this.artists.push(...input.artists);
    if (input.albums) this.albums.push(...input.albums);
    if (input.tracks) this.tracks.push(...input.tracks);
    return this;
  }

  async findArtistById(id: string): Promise<ArtistDetail | null> {
    const artist = this.artists.find((a) => a.id === id);
    if (!artist) return null;
    const albums = this.albums
      .filter((a) => a.artistId === id)
      .map((a) => this.toAlbumSummary(a));
    return { artist, albums };
  }

  async findAlbumById(id: string): Promise<AlbumDetail | null> {
    const album = this.albums.find((a) => a.id === id);
    if (!album) return null;
    const artistSummary = this.toArtistSummary(album.artistId);
    const tracks = this.tracks.filter((t) => t.albumId === id);
    return { album, artist: artistSummary, tracks };
  }

  async findTrackById(id: string): Promise<Track | null> {
    return this.tracks.find((t) => t.id === id) ?? null;
  }

  async findTrackByIds(ids: readonly string[]): Promise<Track[]> {
    // Port contract: empty input → no iteration (and no DB round-trip in the
    // real adapter). Missing IDs are silently skipped.
    if (ids.length === 0) return [];
    const idSet = new Set(ids);
    return this.tracks.filter((t) => idSet.has(t.id));
  }

  async listArtists(input: ListInput): Promise<PaginatedResult<ArtistSummary>> {
    const total = this.artists.length;
    const skip = (input.page - 1) * input.pageSize;
    const items = this.artists
      .slice(skip, skip + input.pageSize)
      .map((a) => a.toSummary());
    return { items, page: input.page, pageSize: input.pageSize, total };
  }

  async listAlbums(input: ListInput): Promise<PaginatedResult<AlbumSummary>> {
    const total = this.albums.length;
    const skip = (input.page - 1) * input.pageSize;
    const items = this.albums
      .slice(skip, skip + input.pageSize)
      .map((a) => this.toAlbumSummary(a));
    return { items, page: input.page, pageSize: input.pageSize, total };
  }

  async search(input: SearchInput): Promise<SearchResult> {
    const needle = input.q.toLowerCase();
    const artists = input.type && input.type !== 'artist'
      ? []
      : this.artists.filter((a) => a.name.toLowerCase().includes(needle)).map((a) => a.toSummary());
    const albums = input.type && input.type !== 'album'
      ? []
      : this.albums.filter((a) => a.title.toLowerCase().includes(needle)).map((a) => this.toAlbumSummary(a));
    const tracks = input.type && input.type !== 'track'
      ? []
      : this.tracks
          .filter((t) => t.title.toLowerCase().includes(needle))
          .map((t): TrackSummary => ({
            id: t.id,
            title: t.title,
            durationSeconds: t.durationSeconds,
            albumId: t.albumId,
          }))
          .slice(0, input.limit);
    return { artists, albums, tracks };
  }

  private toArtistSummary(artistId: string): ArtistSummary {
    const artist = this.artists.find((a) => a.id === artistId);
    // Defensive: if the artist was not seeded, return a stub summary so the
    // fake does not throw — specs that care about the artist shape seed it.
    return artist
      ? artist.toSummary()
      : { id: artistId, name: 'Unknown Artist' };
  }

  private toAlbumSummary(album: Album): AlbumSummary {
    return {
      id: album.id,
      title: album.title,
      releaseYear: album.releaseYear,
      coverUrl: album.coverUrl,
      artist: this.toArtistSummary(album.artistId),
    };
  }
}

// ---------------------------------------------------------------------------
// Fixture builders — deterministic entities for use-case specs.
// ---------------------------------------------------------------------------

export function buildArtist(
  overrides: Partial<{
    id: string;
    name: string;
    bio: string | null;
    imageUrl: string | null;
    createdAt: Date;
  }> = {},
): Artist {
  return Artist.reconstruct({
    id: overrides.id ?? 'artist-1',
    name: overrides.name ?? 'Artist One',
    bio: overrides.bio ?? null,
    imageUrl: overrides.imageUrl ?? null,
    createdAt: overrides.createdAt ?? EPOCH,
  });
}

export function buildAlbum(
  overrides: Partial<{
    id: string;
    title: string;
    releaseYear: number | null;
    coverUrl: string | null;
    artistId: string;
    createdAt: Date;
  }> = {},
): Album {
  return Album.reconstruct({
    id: overrides.id ?? 'album-1',
    title: overrides.title ?? 'Album One',
    releaseYear: overrides.releaseYear ?? 2024,
    coverUrl: overrides.coverUrl ?? null,
    artistId: overrides.artistId ?? 'artist-1',
    createdAt: overrides.createdAt ?? EPOCH,
  });
}

export function buildTrack(
  overrides: Partial<{
    id: string;
    title: string;
    durationSeconds: number;
    filePath: string;
    trackNumber: number;
    albumId: string;
    createdAt: Date;
  }> = {},
): Track {
  return Track.reconstruct({
    id: overrides.id ?? 'track-1',
    title: overrides.title ?? 'Track One',
    durationSeconds: overrides.durationSeconds ?? 213,
    filePath: overrides.filePath ?? '/storage/track-1.mp3',
    trackNumber: overrides.trackNumber ?? 1,
    albumId: overrides.albumId ?? 'album-1',
    createdAt: overrides.createdAt ?? EPOCH,
  });
}
