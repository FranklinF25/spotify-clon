import type { Album } from './album.entity';
import type { Artist } from './artist.entity';
import type { Track } from './track.entity';

/**
 * Read-model value objects — the projection shapes the catalog publishes
 * (CAT-PR2a-05).
 *
 * These live in `domain/` (NOT `application/` or `shared/`) because they are
 * PORT RETURN TYPES — part of the domain contract that
 * `CatalogRepositoryPort` publishes. JD Round 3 learning: any other layer
 * creates a forbidden import (`domain → application` or `shared → domain`),
 * and `domain → domain` is always legal per the ESLint boundary rule
 * `{ from: 'domain', allow: ['domain', 'shared'] }`.
 *
 * These are NOT HTTP shapes — the controller may map them to HTTP responses.
 * They are repository return shapes that any layer consuming the port can use.
 *
 * Framework-free by design: zero NestJS / Prisma imports (enforced by the
 * architecture portfolio test CAT-PR2a-13).
 */

/** Lean artist projection used by list endpoints and nested embedding. */
export interface ArtistSummary {
  id: string;
  name: string;
}

/**
 * Lean album projection. Embeds an `ArtistSummary` so list endpoints can show
 * "Album One — by Artist One" in a single round-trip.
 */
export interface AlbumSummary {
  id: string;
  title: string;
  releaseYear: number | null;
  coverUrl: string | null;
  artist: ArtistSummary;
}

/**
 * Returned by `findArtistById` — embeds album summaries for the
 * `/artists/:id` detail endpoint (spec-locked embedding policy).
 */
export interface ArtistDetail {
  artist: Artist;
  albums: AlbumSummary[];
}

/**
 * Returned by `findAlbumById` — embeds the artist summary + tracks
 * (spec-locked shape for the `/albums/:id` detail endpoint).
 */
export interface AlbumDetail {
  album: Album;
  artist: ArtistSummary;
  tracks: Track[];
}

/** Generic offset-pagination envelope for list endpoints. */
export interface PaginatedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

/**
 * Lean track projection used by `SearchResult`. Carries `albumId` as a
 * primitive (NOT embedded `AlbumSummary`) — asymmetric with
 * `AlbumSummary.artist` but acceptable for search-hit payloads (carry-over
 * CO-catalog-5: do NOT "fix" this asymmetry).
 */
export interface TrackSummary {
  id: string;
  title: string;
  durationSeconds: number;
  albumId: string;
}

/**
 * Grouped full-text search result. Uses summaries (NOT raw entities) so
 * `filePath` never leaks and the shape is consistent with list endpoints
 * (S4). All three arrays are always present (empty when no matches).
 */
export interface SearchResult {
  artists: ArtistSummary[];
  albums: AlbumSummary[];
  tracks: TrackSummary[];
}
