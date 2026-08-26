import { queryOptions, useQuery } from '@tanstack/react-query';
import { httpClient } from '@/lib/api/http-client';
import { endpoints } from '@/lib/api/endpoints';
import type { SearchResult } from '@/types/api';

/**
 * searchQueryOptions (REQ-FE-010, DESIGN §5.1) — the SINGLE source of truth
 * for the `GET /search?q=&type=` cache contract, extracted via the TanStack
 * v5 `queryOptions()` helper (FE-PR5 — AddTrackPicker adapter). Both access
 * paths share it verbatim, so queryKey/queryFn/staleTime can NEVER drift:
 *  - `useSearch` — the declarative hook (SearchPage).
 *  - `queryClient.fetchQuery(searchQueryOptions(...))` — the imperative
 *    adapter on PlaylistDetailPage, which needs a PULL-shaped `onSearch`
 *    (debounce lives in the molecule, so the page cannot know `q` at render
 *    time — a hook argument would never update).
 *
 * `enabled` gates the HOOK form only (fetchQuery is only ever called with a
 * non-empty q by the picker's own empty-query guard; callers double-guard).
 *
 * Query key is the STABLE array `['search', q, type]` — `type` is the
 * SINGULAR 'artist' | 'album' | 'track' | undefined (JD fix #1 — backend
 * `dto/search.dto.ts` uses `z.enum(['artist','album','track']).optional()`,
 * NOT a comma-joined plural).
 */
export function searchQueryOptions(
  q: string,
  type?: 'artist' | 'album' | 'track',
) {
  return queryOptions({
    queryKey: ['search', q, type],
    queryFn: () => httpClient.get<SearchResult>(endpoints.search(q, type)),
    // REQ-FE-010 scenario "Empty query does not hit the backend" — `enabled`
    // is `q.length > 0` (NOT `Boolean(q)`) so a literal '' is excluded
    // unambiguously; an all-whitespace `q` is left for `searchSchema.min(1)`
    // upstream OR trimmed at the page level.
    enabled: q.length > 0,
    staleTime: 30_000,
  });
}

/**
 * useSearch (REQ-FE-010, DESIGN §5.1) — TanStack Query owns the server
 * cache for `GET /search?q=&type=`. The hook is `enabled` ONLY when
 * `q.length > 0`, so an empty query issues NO backend request and the
 * SearchPage renders its intro/empty state (REQ-FE-010 scenario "Empty
 * query does not hit the backend"). Delegates to `searchQueryOptions`
 * (see above) — zero duplicated option literals.
 */
export function useSearch(
  q: string,
  type?: 'artist' | 'album' | 'track',
) {
  return useQuery(searchQueryOptions(q, type));
}
