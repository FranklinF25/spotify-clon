import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { httpClient } from '@/lib/api/http-client';
import { endpoints } from '@/lib/api/endpoints';
import { paginationSchema } from '@/lib/zod-schemas/pagination';
import type { AlbumSummary, PaginatedResult } from '@/types/api';

/**
 * useAlbums (REQ-FE-009, REQ-FE-006; DESIGN §5.1) — TanStack Query owns the
 * server cache for the album list. The query key is a STABLE array
 * `['albums','list',{page,pageSize}]` parsed via `paginationSchema` so cache
 * identity is stable across re-renders (avoids cache fragmentation).
 *
 * `placeholderData: keepPreviousData` keeps page-1 items visible while page-2
 * loads (REQ-FE-009 scenario "keepPreviousData avoids an empty flash").
 */
export function useAlbums(rawInput: { page?: number; pageSize?: number }) {
  const input = paginationSchema.parse(rawInput);
  return useQuery({
    queryKey: ['albums', 'list', input],
    queryFn: () =>
      httpClient.get<PaginatedResult<AlbumSummary>>(
        endpoints.albums.list(input.page, input.pageSize),
      ),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}
