import { useQuery } from '@tanstack/react-query';
import { httpClient } from '@/lib/api/http-client';
import { endpoints } from '@/lib/api/endpoints';
import type { SavedAlbum } from '@/types/api';

/**
 * useLibraryAlbums (REQ-FE-016; DESIGN §9.2). queryKey
 * `['library','albums']`. GET /library/albums is user-scoped server-side
 * and returns the bare `SavedAlbum[]` ordered `addedAt` desc (the backend
 * owns recency — zero client re-sort).
 */
export function useLibraryAlbums() {
  return useQuery({
    queryKey: ['library', 'albums'],
    queryFn: () => httpClient.get<SavedAlbum[]>(endpoints.library.albums),
  });
}
