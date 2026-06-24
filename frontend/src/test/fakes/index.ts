import type {
  AlbumDetail,
  AlbumSummary,
  ArtistDetail,
  ArtistSummary,
  PaginatedResult,
  SearchResult,
  TrackPrimitive,
  UserPrimitive,
} from '@/types/api';

/**
 * Deterministic fake builders mirroring the VERIFIED backend projections
 * (DESIGN §10; mirrors catalog's mulberry32 discipline — same call sequence
 * → same artifacts → stable specs).
 *
 * MSW handlers echo `:id` path params (see handlers.ts), so path-id matching
 * is deterministic regardless of this counter; the counter only exists to
 * generate unique IDs for list endpoints.
 */
let seq = 0;
const nextId = (prefix: string) => `${prefix}-${String(++seq).padStart(3, '0')}`;

/** Reset the sequence between tests if a spec needs a deterministic baseline. */
export function resetFakeSeq(): void {
  seq = 0;
}

export function buildUser(o: Partial<UserPrimitive> = {}): UserPrimitive {
  return {
    id: nextId('user'),
    email: `user${seq}@example.com`,
    displayName: `User ${seq}`,
    ...o,
  };
}

export function buildArtist(o: Partial<ArtistSummary> = {}): ArtistSummary {
  return { id: nextId('artist'), name: `Artist ${seq}`, ...o };
}

export function buildTrack(o: Partial<TrackPrimitive> = {}): TrackPrimitive {
  return {
    id: nextId('track'),
    title: `Track ${seq}`,
    durationSeconds: 180 + (seq % 60),
    trackNumber: seq,
    albumId: 'album-001',
    ...o,
  };
}

export function buildAlbum(o: Partial<AlbumSummary> = {}): AlbumSummary {
  return {
    id: nextId('album'),
    title: `Album ${seq}`,
    releaseYear: 2000 + (seq % 25),
    coverUrl: null,
    artist: buildArtist(),
    ...o,
  };
}

export function buildAlbumDetail(
  o: Partial<AlbumDetail> = {},
): AlbumDetail {
  const id = o.id ?? nextId('album');
  const artist = o.artist ?? buildArtist();
  // Non-empty tracks[] by default — the contract suite's drift test
  // (FE-PR1-11) deliberately omits tracks to prove the suite catches it.
  const tracks =
    o.tracks ??
    [
      buildTrack({ albumId: id, trackNumber: 1 }),
      buildTrack({ albumId: id, trackNumber: 2 }),
      buildTrack({ albumId: id, trackNumber: 3 }),
    ];
  return {
    id,
    title: `Album ${seq}`,
    releaseYear: 2000 + (seq % 25),
    coverUrl: null,
    artistId: artist.id,
    artist,
    tracks,
    ...o,
  };
}

export function buildArtistDetail(
  o: Partial<ArtistDetail> = {},
): ArtistDetail {
  const id = o.id ?? nextId('artist');
  const albums =
    o.albums ??
    [
      buildAlbum({ artist: { id, name: `Artist ${seq}` } }),
      buildAlbum(),
    ];
  return {
    id,
    name: `Artist ${seq}`,
    bio: null,
    imageUrl: null,
    albums,
    ...o,
  };
}

export function buildSearchResult(o: Partial<SearchResult> = {}): SearchResult {
  return {
    artists: [buildArtist()],
    albums: [buildAlbum()],
    tracks: [
      {
        id: nextId('track'),
        title: `Track ${seq}`,
        durationSeconds: 200,
        albumId: 'album-001',
      },
    ],
    ...o,
  };
}

/** Wrap a list in the backend's PaginatedResult envelope. */
export function paginate<T>(
  items: T[],
  page = 1,
  pageSize = 20,
): PaginatedResult<T> {
  return { items, total: items.length, page, pageSize };
}
