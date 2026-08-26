/**
 * Frontend-owned API contract — hand-synced to the VERIFIED backend
 * projections (DESIGN §4.1). The backend's `toPrimitive()` outputs ARE the
 * public contract; these interfaces mirror them exactly.
 *
 * Source of truth (READ before editing any of these):
 *   - Track.toPrimitive()         → catalog/domain/track.entity.ts
 *   - Album.toPrimitive()         → catalog/domain/album.entity.ts
 *   - Artist.toPrimitive()        → catalog/domain/artist.entity.ts
 *   - read-models.ts              → *Summary shapes (AlbumSummary.artist
 *                                    embedded; TrackSummary.albumId is
 *                                    INTENTIONALLY present — the read-models
 *                                    "asymmetry note" says do NOT remove it)
 *   - AuthController.{register,login,refresh}() — refresh returns
 *     { accessToken } ONLY (no `user`); register/login return
 *     { accessToken, user }.
 *
 * The backend's internal storage path field MUST NOT leak into any of these
 * interfaces — the architecture test (FE-PR1-13) asserts its absence in this
 * file via a regex scoped here (NOT a tree-wide grep, which would false-
 * positive on docs/comments). Drift is mitigated by the MSW contract suite
 * (FE-PR1-11) parsing every fixture through the zod mirrors / assertion
 * schemas.
 */

export interface UserPrimitive {
  id: string;
  email: string;
  displayName: string;
}

export interface ArtistSummary {
  id: string;
  name: string;
}

// Mirrors `AlbumSummary` in backend catalog/domain/read-models.ts.
// `releaseYear` + `coverUrl` are nullable; `artist` is embedded so AlbumCard
// renders without a second hop.
export interface AlbumSummary {
  id: string;
  title: string;
  releaseYear: number | null;
  coverUrl: string | null;
  artist: ArtistSummary;
}

// Mirrors `Track.toPrimitive()` in catalog/domain/track.entity.ts.
// NOTE: `durationSeconds` (NOT `durationMs`) and `trackNumber` IS present.
export interface TrackPrimitive {
  id: string;
  title: string;
  durationSeconds: number;
  trackNumber: number;
  albumId: string;
}

// Mirrors the GET /albums/:id controller shape:
//   `{ ...album.toPrimitive(), artist, tracks: tracks.map(t => t.toPrimitive()) }`
// `album.toPrimitive()` contributes `artistId`; the controller spreads
// `artist` (ArtistSummary) + `tracks` (TrackPrimitive[]) on top. Detail is
// WIDER than AlbumSummary — it does NOT `extends AlbumSummary` (different
// fields: artistId present, artist embedded, tracks array).
export interface AlbumDetail {
  id: string;
  title: string;
  releaseYear: number | null;
  coverUrl: string | null;
  artistId: string;
  artist: ArtistSummary; // always present on /albums/:id (never partial)
  tracks: TrackPrimitive[]; // non-optional array (can be empty, not undefined)
}

// Mirrors the GET /artists/:id controller shape:
//   `{ ...artist.toPrimitive(), albums }`
// `artist.toPrimitive()` contributes `bio` + `imageUrl` (both nullable); the
// controller spreads `albums` (AlbumSummary[]) on top. Detail is WIDER than
// ArtistSummary — it does NOT `extends ArtistSummary`.
export interface ArtistDetail {
  id: string;
  name: string;
  bio: string | null;
  imageUrl: string | null;
  albums: AlbumSummary[]; // embedded by GET /artists/:id controller
}

// Mirrors `TrackSummary` in catalog/domain/read-models.ts. `albumId` IS
// present here (the read-models asymmetry note explicitly says do NOT remove
// it — search hits carry albumId as a primitive, not embedded AlbumSummary).
export interface TrackSummary {
  id: string;
  title: string;
  durationSeconds: number;
  albumId: string;
}

// Mirrors `UploadTrackResult` in catalog/application/upload-track.use-case.ts
// — the 201 body of POST /tracks/upload (REQ-UPLOAD-001). The created/updated
// track plus the artist and album it landed under. The internal storage-path
// field is deliberately absent (R4 guard — the FE-PR1-13 architecture regex
// asserts that here too, so this comment avoids spelling the token out); the
// track sub-shape is NARROWER than TrackPrimitive: no `trackNumber` (uploads
// land in a position-1 "Singles" album by default, the number is not part of
// the upload contract).
export interface UploadResult {
  track: { id: string; title: string; durationSeconds: number; albumId: string };
  artist: { id: string; name: string };
  album: { id: string; title: string };
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface SearchResult {
  artists: ArtistSummary[];
  albums: AlbumSummary[];
  tracks: TrackSummary[];
}

// Auth responses — mirrors AuthController register/login/refresh shapes.
// register/login return { accessToken, user }; refresh returns { accessToken }
// ONLY (the boot flow hydrates `user` via a separate GET /me — DESIGN §4.3).
export interface AuthResponse {
  accessToken: string;
  user: UserPrimitive;
}
export interface RefreshResponse {
  accessToken: string;
}

// --- Playlists (PR-3; DESIGN §12.5) ---------------------------------------
// Hand-synced to the backend `playlists` context projections (same discipline
// as TrackPrimitive). JSON dates arrive as ISO strings; the backend
// `toPrimitive()` outputs ARE the public contract.
//
// Source of truth (READ before editing):
//   - Playlist.toPrimitive()      → playlists/domain/playlist.entity.ts
//   - PlaylistSummary (read-model)→ playlists/domain/read-models.ts
//   - PlaylistTrack.toPrimitive() → playlists/domain/playlist-track.entity.ts

// Mirrors `Playlist.toPrimitive()`. `createdAt === updatedAt` on create.
export interface PlaylistPrimitive {
  id: string;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

// Mirrors `PlaylistSummary` in playlists read-models. The GET /playlists list
// is owner-scoped server-side, so `userId` is intentionally absent here.
export interface PlaylistSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

// Mirrors `PlaylistTrack.toPrimitive()` — the POSITION row (not hydrated).
// The hydrated GET /:id/tracks response returns TrackPrimitive[] (the
// survivors, re-sorted by position); this interface describes a single raw
// row as returned by POST /:id/tracks (201) and POST /:id/reorder (200).
export interface PlaylistTrackPrimitive {
  position: number;
  trackId: string;
  addedAt: string;
}

// --- Library (F6; DESIGN §9.6) ---------------------------------------------
// Hand-synced to the backend `library` context response projection
// (ListLibraryUseCase's SavedAlbum, serialized as JSON — `addedAt` Date →
// ISO string). Reuses AlbumSummary verbatim: the catalog projection is the
// card payload; only the (user, album) relation is new.
export interface SavedAlbum {
  album: AlbumSummary;
  addedAt: string; // ISO string from JSON
}

/**
 * Backend error vocabulary (R-app-2; hand-synced to the backend `ErrorCode`
 * enum in identity/error-codes.ts + playlists widening). Used to type
 * `ApiError.code` so consumption sites get exhaustive narrowing.
 *
 * `UNKNOWN` is the GENERIC fallback for non-envelope / unrecognised codes.
 */
export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INTERNAL_ERROR'
  | 'INVALID_PAGINATION'
  | 'INVALID_QUERY'
  | 'UNPROCESSABLE_ENTITY'
  | 'UNKNOWN';
