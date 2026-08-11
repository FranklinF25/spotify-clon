import { useQuery } from '@tanstack/react-query';
import { httpClient } from '@/lib/api/http-client';
import { endpoints } from '@/lib/api/endpoints';
import type { PlaylistSummary } from '@/types/api';

/**
 * usePlaylists (REQ-FE-014; DESIGN §12.2). queryKey `['playlists','list']`.
 * GET /playlists is owner-scoped server-side, so the response is the current
 * user's playlists only. The list projection omits `userId` (PlaylistSummary).
 */
export function usePlaylists() {
  return useQuery({
    queryKey: ['playlists', 'list'],
    queryFn: () =>
      httpClient.get<PlaylistSummary[]>(endpoints.playlists.list),
  });
}
