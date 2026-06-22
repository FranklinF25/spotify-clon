import { describe, expect, it } from 'vitest';

import { Album } from './album.entity';
import { Artist } from './artist.entity';
import { Track } from './track.entity';
import type {
  AlbumDetail,
  AlbumSummary,
  ArtistDetail,
  ArtistSummary,
  PaginatedResult,
  SearchResult,
  TrackSummary,
} from './read-models';

/**
 * Type-level smoke spec for `domain/read-models.ts` (CAT-PR2a-05).
 *
 * The read-models are pure TS interfaces — there is no behaviour to test at
 * the unit level (they are enforced transitively by the use-case specs +
 * the architecture portfolio test). This spec asserts the shapes COMPILE
 * when fed realistic data and that runtime construction round-trips fields,
 * so a future rename/retype surfaces here first.
 */
describe('catalog read-models', () => {
  const artistSummary: ArtistSummary = { id: 'a1', name: 'Artist One' };
  const albumSummary: AlbumSummary = {
    id: 'l1',
    title: 'Album One',
    releaseYear: 2024,
    coverUrl: null,
    artist: artistSummary,
  };
  const trackSummary: TrackSummary = {
    id: 't1',
    title: 'Track One',
    durationSeconds: 213,
    albumId: 'l1',
  };

  it('ArtistSummary is the lean { id, name } shape', () => {
    expect(artistSummary).toEqual({ id: 'a1', name: 'Artist One' });
  });

  it('AlbumSummary embeds an ArtistSummary', () => {
    expect(albumSummary.artist).toEqual({ id: 'a1', name: 'Artist One' });
  });

  it('PaginatedResult envelopes a typed items array with page/pageSize/total', () => {
    const page: PaginatedResult<ArtistSummary> = {
      items: [artistSummary],
      page: 1,
      pageSize: 20,
      total: 1,
    };
    expect(page.items).toHaveLength(1);
    expect(page.total).toBe(1);
  });

  it('SearchResult groups summaries (NOT raw entities) — filePath never leaks', () => {
    const result: SearchResult = {
      artists: [artistSummary],
      albums: [albumSummary],
      tracks: [trackSummary],
    };
    expect(result.tracks[0]).not.toHaveProperty('filePath');
  });

  it('ArtistDetail carries the Artist entity + album summaries', () => {
    const artist = Artist.reconstruct({
      id: 'a1',
      name: 'Artist One',
      bio: null,
      imageUrl: null,
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
    });
    const detail: ArtistDetail = { artist, albums: [albumSummary] };
    expect(detail.artist.id).toBe('a1');
    expect(detail.albums).toHaveLength(1);
  });

  it('AlbumDetail carries the Album entity, artist summary, and Track entities', () => {
    const album = Album.reconstruct({
      id: 'l1',
      title: 'Album One',
      releaseYear: 2024,
      coverUrl: null,
      artistId: 'a1',
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
    });
    const track = Track.reconstruct({
      id: 't1',
      title: 'Track One',
      durationSeconds: 213,
      filePath: '/storage/t1.mp3',
      trackNumber: 1,
      albumId: 'l1',
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
    });
    const detail: AlbumDetail = { album, artist: artistSummary, tracks: [track] };
    expect(detail.album.id).toBe('l1');
    expect(detail.tracks[0].filePath).toBe('/storage/t1.mp3');
  });
});
