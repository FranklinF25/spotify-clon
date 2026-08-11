import { describe, expect, it } from 'vitest';
import { endpoints } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/http-client';
import type {
  ApiErrorCode,
  PlaylistPrimitive,
  PlaylistSummary,
  PlaylistTrackPrimitive,
} from '@/types/api';

/**
 * FE-PR3-01 — Playlist types + endpoints namespace + ApiErrorCode union
 * (R-app-2; DESIGN §12.5).
 *
 * The three Playlist interfaces are hand-synced to the backend projections
 * (same discipline as TrackPrimitive). The `playlists` endpoints namespace
 * mirrors `artists`/`albums`. `ApiErrorCode` widens the error vocabulary to
 * include `'UNPROCESSABLE_ENTITY'` so an unknown-trackId 422 is typed
 * end-to-end (REQ-P-007).
 */

const ISO = '2025-01-01T00:00:00.000Z';

describe('Playlist types — hand-synced backend projections', () => {
  it('PlaylistPrimitive round-trips a JSON fixture structurally', () => {
    const fixture = {
      id: 'pl-1',
      userId: 'user-1',
      title: 'Road trip',
      createdAt: ISO,
      updatedAt: ISO,
    } satisfies PlaylistPrimitive;
    expect(fixture.id).toBe('pl-1');
    expect(fixture.createdAt).toBe(ISO);
  });

  it('PlaylistSummary omits userId (the list projection is owner-scoped)', () => {
    const summary = {
      id: 'pl-1',
      title: 'Road trip',
      createdAt: ISO,
      updatedAt: ISO,
    } satisfies PlaylistSummary;
    expect(summary.id).toBe('pl-1');
    // userId is intentionally NOT part of the list projection.
    expect('userId' in summary).toBe(false);
  });

  it('PlaylistTrackPrimitive round-trips a position/trackId/addedAt row', () => {
    const row = {
      position: 2,
      trackId: 't-2',
      addedAt: ISO,
    } satisfies PlaylistTrackPrimitive;
    expect(row.position).toBe(2);
    expect(row.trackId).toBe('t-2');
  });
});

describe('endpoints.playlists namespace (DESIGN §12.5)', () => {
  it('encodes ids with encodeURIComponent', () => {
    expect(endpoints.playlists.detail('a/b')).toBe('/api/v1/playlists/a%2Fb');
    expect(endpoints.playlists.rename('a/b')).toBe('/api/v1/playlists/a%2Fb');
    expect(endpoints.playlists.remove('a b')).toBe('/api/v1/playlists/a%20b');
    expect(endpoints.playlists.tracks('a/b')).toBe(
      '/api/v1/playlists/a%2Fb/tracks',
    );
    expect(endpoints.playlists.addTrack('a/b')).toBe(
      '/api/v1/playlists/a%2Fb/tracks',
    );
    expect(endpoints.playlists.removeTrack('a/b', 3)).toBe(
      '/api/v1/playlists/a%2Fb/tracks/3',
    );
    expect(endpoints.playlists.reorder('a/b')).toBe(
      '/api/v1/playlists/a%2Fb/reorder',
    );
  });

  it('list + create point at the collection root', () => {
    expect(endpoints.playlists.list).toBe('/api/v1/playlists');
    expect(endpoints.playlists.create).toBe('/api/v1/playlists');
  });

  it('removeTrack interpolates the position as the last path segment', () => {
    expect(endpoints.playlists.removeTrack('pl-1', 5)).toBe(
      '/api/v1/playlists/pl-1/tracks/5',
    );
  });
});

describe('ApiErrorCode union (R-app-2 widen)', () => {
  it('accepts UNPROCESSABLE_ENTITY as a member', () => {
    const code: ApiErrorCode = 'UNPROCESSABLE_ENTITY';
    expect(code).toBe('UNPROCESSABLE_ENTITY');
  });

  it('ApiError.code is typed as the union (NOT string)', () => {
    // Construction with every backend vocab member MUST compile — this is the
    // R-app-2 invariant: the union is a superset of every literal previously
    // compared at consumption sites.
    const codes: ApiErrorCode[] = [
      'VALIDATION_ERROR',
      'UNAUTHORIZED',
      'FORBIDDEN',
      'NOT_FOUND',
      'CONFLICT',
      'INTERNAL_ERROR',
      'INVALID_PAGINATION',
      'INVALID_QUERY',
      'UNPROCESSABLE_ENTITY',
      'UNKNOWN',
    ];
    for (const code of codes) {
      const err = new ApiError(code, 'msg', 400);
      // The assignment below type-checks ONLY because `err.code` is the union,
      // not `string`. If someone widened it back to string, TS would still
      // allow this — but the assertion below proves the value round-trips.
      const narrowed: ApiErrorCode = err.code;
      expect(narrowed).toBe(code);
    }
  });
});
