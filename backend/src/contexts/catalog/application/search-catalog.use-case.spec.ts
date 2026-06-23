import { describe, expect, it, vi } from 'vitest';

import { MAX_PAGE_SIZE } from '../../../shared/pagination';
import { InvalidQueryError } from '../../../shared/errors/invalid-query-error';
import {
  InMemoryCatalogRepository,
  buildAlbum,
  buildArtist,
  buildTrack,
} from '../../../../test/helpers/catalog-fakes';
import { SearchCatalogUseCase } from './search-catalog.use-case';

/**
 * Unit spec for `SearchCatalogUseCase` (CAT-PR3c-01).
 *
 * Underpins spec scenarios (R6 "Full-Text Search Endpoint"):
 *   - "Query matches entities across types" — happy path forwards the grouped
 *     result from the catalog port (typed summary arrays, never raw entities).
 *   - "Empty query is rejected" — `q` empty after trim ⇒ `InvalidQueryError`
 *     (code `INVALID_QUERY`). The controller's `validateSearch` wrapper is the
 *     first line of defence, but the use case re-validates after trimming so
 *     a caller that bypasses the wrapper (e.g. an `InMemoryCatalogRepository`
 *     unit test, or a future internal caller) cannot reach the port with an
 *     empty query.
 *
 * Uses the `InMemoryCatalogRepository` fake (CAT-PR2a-07) — no Prisma, no
 * NestJS, no mocks. The fake does a case-insensitive substring match; the
 * real tsvector behaviour (Björk ↔ bjork, ranking) is verified in the PR-3c
 * integration spec, not here.
 */
describe('SearchCatalogUseCase', () => {
  function setup() {
    const catalog = new InMemoryCatalogRepository();
    const artist = buildArtist({ id: 'a1', name: 'Foo Fighter' });
    const album = buildAlbum({ id: 'l1', title: 'Foo Album', artistId: 'a1' });
    const track = buildTrack({ id: 't1', title: 'Foo Track', albumId: 'l1' });
    // A distractor that MUST NOT match `foo`.
    const other = buildArtist({ id: 'a2', name: 'Bar Singer' });
    catalog.seed({ artists: [artist, other], albums: [album], tracks: [track] });
    const useCase = new SearchCatalogUseCase(catalog);
    return { useCase, catalog };
  }

  it('forwards the grouped SearchResult { artists, albums, tracks } from the port', async () => {
    const { useCase } = setup();

    const result = await useCase.execute({ q: 'foo' });

    // All three arrays are present (R6 contract: arrays always present).
    expect(result.artists.map((a) => a.name)).toEqual(['Foo Fighter']);
    expect(result.albums.map((a) => a.title)).toEqual(['Foo Album']);
    expect(result.tracks.map((t) => t.title)).toEqual(['Foo Track']);
    // ArtistSummary carries only { id, name }.
    expect(result.artists[0]).toEqual({ id: 'a1', name: 'Foo Fighter' });
    // TrackSummary MUST NOT carry filePath (R4/R6 — internal storage detail).
    expect(result.tracks[0]).not.toHaveProperty('filePath');
    expect(Object.keys(result.tracks[0]!).sort()).toEqual(
      ['albumId', 'durationSeconds', 'id', 'title'].sort(),
    );
  });

  it('forwards limit: MAX_PAGE_SIZE (spec-locked 100) to the port', async () => {
    const { useCase, catalog } = setup();
    const spy = vi.spyOn(catalog, 'search');

    await useCase.execute({ q: 'foo' });

    expect(spy).toHaveBeenCalledWith({
      q: 'foo',
      type: undefined,
      limit: MAX_PAGE_SIZE,
    });
    spy.mockRestore();
  });

  it('trims q before forwarding (defense-in-depth — controller wrapper already trims)', async () => {
    const { useCase, catalog } = setup();
    const spy = vi.spyOn(catalog, 'search');

    await useCase.execute({ q: '  foo  ' });

    expect(spy).toHaveBeenCalledWith({
      q: 'foo',
      type: undefined,
      limit: MAX_PAGE_SIZE,
    });
    spy.mockRestore();
  });

  it('rejects an empty q with InvalidQueryError (R6 "Empty query is rejected")', async () => {
    const { useCase } = setup();

    await expect(useCase.execute({ q: '' })).rejects.toBeInstanceOf(
      InvalidQueryError,
    );
  });

  it('rejects a whitespace-only q with InvalidQueryError (post-trim emptiness)', async () => {
    const { useCase } = setup();

    await expect(useCase.execute({ q: '   ' })).rejects.toBeInstanceOf(
      InvalidQueryError,
    );
  });

  it('forwards the type filter when provided (port empties the other groups)', async () => {
    const { useCase } = setup();

    const result = await useCase.execute({ q: 'foo', type: 'artist' });

    // The port contract: when `type` is set, only the matching group is
    // populated. The InMemory fake honours this (`input.type !== 'artist'`
    // yields `[]` for albums + tracks).
    expect(result.artists.map((a) => a.name)).toEqual(['Foo Fighter']);
    expect(result.albums).toEqual([]);
    expect(result.tracks).toEqual([]);
  });
});
