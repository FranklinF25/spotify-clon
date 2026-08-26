import { queryOptions, useQuery } from '@tanstack/react-query';
import { httpClient } from '@/lib/api/http-client';
import { endpoints } from '@/lib/api/endpoints';
import type { AlbumDetail } from '@/types/api';

/**
 * albumQueryOptions (REQ-FE-009; DESIGN §5.1) — the SINGLE source of truth
 * for the `GET /albums/:id` cache contract, extracted via the TanStack v5
 * `queryOptions()` helper (mirrors the FE-PR5 `searchQueryOptions` extraction
 * precedent). Both access paths share it verbatim, so queryKey/queryFn can
 * NEVER drift:
 *  - `useAlbum` — the declarative hook (AlbumPage).
 *  - `queryClient.fetchQuery(albumQueryOptions(...))` — the imperative
 *    adapter on SearchPage, which plays an album from a SUMMARY and needs the
 *    detail's tracks at callback time (the play click), not at render time.
 *
 * `enabled: Boolean(id)` so an empty id (AlbumPage before the param resolves)
 * issues NO request; imperative `fetchQuery` callers double-guard themselves
 * (fetchQuery does not consult `enabled`).
 */
export function albumQueryOptions(id: string) {
  return queryOptions({
    queryKey: ['albums', 'detail', id],
    queryFn: () => httpClient.get<AlbumDetail>(endpoints.albums.detail(id)),
    enabled: Boolean(id),
  });
}

/**
 * useAlbum (REQ-FE-009; DESIGN §5.1) — album detail with embedded tracks +
 * artist. queryKey `['albums','detail',id]` via `albumQueryOptions` (zero
 * duplicated option literals). `enabled: Boolean(id)` so an empty id (AlbumPage
 * before the param resolves) issues NO request.
 */
export function useAlbum(id: string) {
  return useQuery(albumQueryOptions(id));
}
