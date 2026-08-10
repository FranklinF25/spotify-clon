import { useQuery } from '@tanstack/react-query';
import { httpClient } from '@/lib/api/http-client';
import { endpoints } from '@/lib/api/endpoints';
import type { TrackPrimitive } from '@/types/api';

/**
 * usePlaylistTracks (REQ-FE-015; DESIGN §12.2). queryKey
 * `['playlists','tracks',id]`. Returns the HYDRATED `TrackPrimitive[]` —
 * GET /playlists/:id/tracks is an OPEN READ; broken refs are silent-omitted
 * and survivors re-sorted by position server-side. Repeatable trackId is
 * allowed (the same track can appear at multiple positions).
 */
export function usePlaylistTracks(id: string) {
  return useQuery({
    queryKey: ['playlists', 'tracks', id],
    queryFn: () =>
      httpClient.get<TrackPrimitive[]>(endpoints.playlists.tracks(id)),
    enabled: Boolean(id),
  });
}
