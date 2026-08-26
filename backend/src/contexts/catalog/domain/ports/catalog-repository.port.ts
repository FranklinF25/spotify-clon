import type { Track } from '../track.entity';
import type {
  AlbumDetail,
  AlbumSummary,
  ArtistDetail,
  ArtistSummary,
  PaginatedResult,
  SearchResult,
} from '../read-models';

/**
 * Offset pagination input for list endpoints (DESIGN §Driven Port).
 */
export interface ListInput {
  page: number;
  pageSize: number;
}

/**
 * Full-text search input. `type` filters to a single group; when omitted all
 * three groups are populated. `limit` is the per-group cap (callers pass
 * `MAX_PAGE_SIZE` from `shared/pagination.ts`).
 */
export interface SearchInput {
  q: string;
  /** When set, only the matching group is populated; the other two are empty. */
  type?: 'artist' | 'album' | 'track';
  /** Per-group cap — use `MAX_PAGE_SIZE` from shared/pagination.ts (spec-locked 100). */
  limit: number;
}

/**
 * Write-side input for {@link CatalogRepositoryPort.upsertCatalogEntry} —
 * one artist / album / track triple with ALREADY-DERIVED deterministic ids
 * (the caller derives them with the shared `audio-meta` kernel so uploads
 * and re-seeds converge on the same rows).
 *
 * Mirrors the seeder's snapshot rows (camelCase domain naming): bio /
 * image_url / cover_url are not uploadable (NULL on insert), matching the
 * seed's own values.
 */
export interface CatalogEntryInput {
  artist: { id: string; name: string };
  album: { id: string; title: string; releaseYear: number | null; artistId: string };
  track: {
    id: string;
    title: string;
    durationSeconds: number;
    filePath: string;
    trackNumber: number;
    albumId: string;
  };
}

/**
 * Driven port (secondary) — abstracts read access to the catalog.
 *
 * CROSS-CONTEXT CONTRACT — consumed by:
 *   - `catalog` use cases (this change)
 *   - `playback` (future change) — `findTrackById` for single-track streaming
 *     and `findTrackByIds` for queue resolution.
 *   - `library` (F6) — `findAlbumByIds` for saved-album hydration and the
 *     add-album existence check.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ EVOLUTION RULES (JD learning #6 — additive vs mutating)                  │
 * ├──────────────────────────────────────────────────────────────────────────┤
 * │ • ADDITIVE evolution (NON-BREAKING): adding new methods to this port     │
 * │   (e.g. a future `findArtistsByGenre`) does NOT break `playback`. New    │
 * │   methods may be added freely. `upsertCatalogEntry` (REQ-UPLOAD-002) is  │
 * │   the FIRST exercise of this rule — the port's first WRITE method,      │
 * │   added alongside the original 7 reads without touching any of them.    │
 * │ • MUTATING evolution (BREAKING for every consumer): renaming or          │
 * │   re-typing any of the 8 methods below forces churn in every consumer.   │
 * │   What stays locked is the signature of these 8 methods.                 │
 * │                                                                          │
 * │ Mutations that would force churn later (all BREAKING):                   │
 * │   - renaming any of the 8 locked methods;                                │
 * │   - changing return types (e.g. dropping AlbumDetail for two methods);   │
 * │   - replacing the Track entity's shape (e.g. moving filePath out);       │
 * │   - splitting the port into multiple smaller ports.                      │
 * │ None expected — the design is conservative on purpose.                   │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Implementations:
 *   - `PrismaCatalogRepository` (infrastructure) — production + integration specs
 *   - `InMemoryCatalogRepository` (test/helpers) — application-layer unit specs
 *
 * Framework-free by design: pure TS interface, zero NestJS / Prisma imports
 * (enforced by ESLint boundaries + the architecture portfolio test).
 */
export interface CatalogRepositoryPort {
  /**
   * Single-artist detail with embedded album summaries for the
   * `/artists/:id` endpoint. Null when not found.
   */
  findArtistById(id: string): Promise<ArtistDetail | null>;

  /**
   * Single-album detail with embedded artist summary + tracks (spec-locked
   * shape) for the `/albums/:id` endpoint. Null when not found. If
   * `playback` ever needs "which tracks belong to album X", it reuses this
   * method — no separate `listTracksByAlbum` is added.
   */
  findAlbumById(id: string): Promise<AlbumDetail | null>;

  /**
   * Lean track lookup — used by the catalog `/tracks/:id` endpoint AND by
   * the future `playback` context to resolve a streamable track. The
   * `Track` entity keeps `filePath` as a public readonly field so playback
   * can read it (it is omitted from `toPrimitive()` but NOT from the entity).
   */
  findTrackById(id: string): Promise<Track | null>;

  /**
   * Resolve multiple tracks by ID in a single round-trip (queue resolution).
   *
   * Contract (locked — `playback` queue resolution depends on these):
   *   - Empty `ids` returns `[]` WITHOUT a DB round-trip.
   *   - Missing IDs are silently skipped (no partial-error throw).
   *   - Result length MAY be less than `ids.length` if some IDs don't exist.
   *   - Order of results is NOT guaranteed to match input order — callers
   *     that need a specific order MUST sort client-side.
   */
  findTrackByIds(ids: readonly string[]): Promise<Track[]>;

  /**
   * Resolve multiple album summaries by ID in a single round-trip (F6 — REQ-L-005).
   *
   * Contract (locked — mirrors `findTrackByIds`, consumed by `library`):
   *   - Empty `ids` returns `[]` WITHOUT a DB round-trip.
   *   - Missing IDs are silently skipped — only the FOUND subset is returned,
   *     one entry per existing id, NO placeholder/null entries (REQ-L-005
   *     scenario "Batch lookup returns only the existing subset").
   *   - Result length MAY be less than `ids.length`.
   *   - Order of results is NOT guaranteed to match input order — callers
   *     that need a specific order MUST sort client-side (REQ-L-005 scenario
   *     "Result order is not guaranteed").
   */
  findAlbumByIds(ids: readonly string[]): Promise<AlbumSummary[]>;

  /** Offset-paginated artist summaries for `GET /artists`. */
  listArtists(input: ListInput): Promise<PaginatedResult<ArtistSummary>>;

  /** Offset-paginated album summaries (with embedded artist summary) for `GET /albums`. */
  listAlbums(input: ListInput): Promise<PaginatedResult<AlbumSummary>>;

  /**
   * Grouped full-text search across artists, albums, tracks. Catalog-only —
   * `playback` does NOT consume this method. Ranking scores are NOT exposed
   * to clients (ordering is a repository-side decision).
   */
  search(input: SearchInput): Promise<SearchResult>;

  /**
   * Upsert ONE catalog entry (artist + album + track) in dependency order
   * inside a single transaction (REQ-UPLOAD-002 — the port's first WRITE
   * method, additive per the EVOLUTION RULES above).
   *
   * Row-idempotent by contract: the ids in {@link CatalogEntryInput} are
   * deterministic (derived by the caller), so re-uploading the same derived
   * path OVERWRITES the same rows instead of duplicating them — mirroring
   * the seeder's `ON CONFLICT ("id") DO UPDATE` sync semantics. On conflict
   * every mutable column is updated from the input (a NULL `releaseYear`
   * overwrites a previous year, exactly like a re-seed would).
   *
   * The upserted track is immediately visible to every read method (search
   * included) once the promise resolves.
   */
  upsertCatalogEntry(entry: CatalogEntryInput): Promise<void>;
}
