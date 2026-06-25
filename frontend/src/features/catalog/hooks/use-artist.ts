import { useQuery } from '@tanstack/react-query';
import { httpClient } from '@/lib/api/http-client';
import { endpoints } from '@/lib/api/endpoints';
import type { ArtistDetail } from '@/types/api';

/**
 * useArtist (REQ-FE-009; DESIGN §5.1) — artist detail with embedded albums.
 * queryKey `['artists','detail',id]`. `enabled: Boolean(id)` so an empty id
 * issues NO request.
 */
export function useArtist(id: string) {
  return useQuery({
    queryKey: ['artists', 'detail', id],
    queryFn: () => httpClient.get<ArtistDetail>(endpoints.artists.detail(id)),
    enabled: Boolean(id),
  });
}
