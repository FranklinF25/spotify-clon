import { describe, expect, it } from 'vitest';

import { InvalidPaginationError } from '../../../shared/errors/invalid-pagination-error';
import {
  InMemoryCatalogRepository,
  buildArtist,
} from '../../../../test/helpers/catalog-fakes';
import { ListArtistsUseCase } from './list-artists.use-case';

/**
 * Unit spec for `ListArtistsUseCase` (CAT-PR2a-08).
 *
 * Underpins spec scenarios (R5):
 *   - "List artists with default pagination" (page=1, pageSize=20, total=N)
 *   - "Out-of-range page returns empty items with accurate total"
 *   - "Non-positive or over-max pagination is rejected" (INVALID_PAGINATION)
 *
 * Uses the `InMemoryCatalogRepository` fake (CAT-PR2a-07) — no Prisma, no
 * NestJS, no mocks. The fake is the living port consumer.
 */
describe('ListArtistsUseCase', () => {
  function setup(count = 25) {
    const catalog = new InMemoryCatalogRepository();
    const artists = Array.from({ length: count }, (_, i) =>
      buildArtist({ id: `artist-${i + 1}`, name: `Artist ${i + 1}` }),
    );
    catalog.seed({ artists });
    const useCase = new ListArtistsUseCase(catalog);
    return { useCase, catalog };
  }

  it('applies defaults (page=1, pageSize=20) when no input is given', async () => {
    const { useCase } = setup(25);

    const result = await useCase.execute({});

    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
    expect(result.total).toBe(25);
    expect(result.items).toHaveLength(20);
  });

  it('honours an explicit page + pageSize', async () => {
    const { useCase } = setup(25);

    const result = await useCase.execute({ page: 2, pageSize: 5 });

    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(5);
    expect(result.total).toBe(25);
    expect(result.items).toHaveLength(5);
    // Items on page 2 (pageSize=5) are artists 6..10.
    expect(result.items[0]).toEqual({ id: 'artist-6', name: 'Artist 6' });
  });

  it('returns empty items with accurate total on an out-of-range page', async () => {
    const { useCase } = setup(5);

    const result = await useCase.execute({ page: 999 });

    expect(result.page).toBe(999);
    expect(result.pageSize).toBe(20);
    expect(result.total).toBe(5);
    expect(result.items).toEqual([]);
  });

  it('rejects page=0 with InvalidPaginationError (code INVALID_PAGINATION)', async () => {
    const { useCase } = setup();

    await expect(useCase.execute({ page: 0 })).rejects.toBeInstanceOf(
      InvalidPaginationError,
    );
  });

  it('rejects pageSize=0 with InvalidPaginationError', async () => {
    const { useCase } = setup();

    await expect(useCase.execute({ pageSize: 0 })).rejects.toBeInstanceOf(
      InvalidPaginationError,
    );
  });

  it('rejects pageSize=101 (over MAX_PAGE_SIZE) with InvalidPaginationError', async () => {
    const { useCase } = setup();

    await expect(useCase.execute({ pageSize: 101 })).rejects.toBeInstanceOf(
      InvalidPaginationError,
    );
  });

  it('returns summaries shaped { id, name } — no bio/imageUrl/createdAt leak', async () => {
    const { useCase } = setup(1);

    const result = await useCase.execute({});

    expect(result.items[0]).toEqual({ id: 'artist-1', name: 'Artist 1' });
    expect(result.items[0]).not.toHaveProperty('bio');
    expect(result.items[0]).not.toHaveProperty('imageUrl');
  });
});
