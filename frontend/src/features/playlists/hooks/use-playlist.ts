import { useQuery } from '@tanstack/react-query';
import { httpClient } from '@/lib/api/http-client';
import { endpoints } from '@/lib/api/endpoints';
import type { PlaylistPrimitive } from '@/types/api';

/**
 * usePlaylist (REQ-FE-015; DESIGN §12.2). queryKey `['playlists','detail',id]`.
 * `enabled: Boolean(id)` so an empty id (before the route param resolves)
 * issues NO request — matches the `useAlbum` convention. GET /playlists/:id is
 * an OPEN READ (no ownership check).
 */
export function usePlaylist(id: string) {
  return useQuery({
    queryKey: ['playlists', 'detail', id],
    queryFn: () =>
      httpClient.get<PlaylistPrimitive>(endpoints.playlists.detail(id)),
    enabled: Boolean(id),
  });
}
