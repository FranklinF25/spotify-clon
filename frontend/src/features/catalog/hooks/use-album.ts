import { useQuery } from '@tanstack/react-query';
import { httpClient } from '@/lib/api/http-client';
import { endpoints } from '@/lib/api/endpoints';
import type { AlbumDetail } from '@/types/api';

/**
 * useAlbum (REQ-FE-009; DESIGN §5.1) — album detail with embedded tracks +
 * artist. queryKey `['albums','detail',id]`. `enabled: Boolean(id)` so an empty
 * id (AlbumPage before the param resolves) issues NO request.
 */
export function useAlbum(id: string) {
  return useQuery({
    queryKey: ['albums', 'detail', id],
    queryFn: () => httpClient.get<AlbumDetail>(endpoints.albums.detail(id)),
    enabled: Boolean(id),
  });
}
