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
