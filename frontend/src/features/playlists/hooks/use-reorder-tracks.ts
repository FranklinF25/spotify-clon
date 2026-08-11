import { useMutation, useQueryClient } from '@tanstack/react-query';
import { httpClient } from '@/lib/api/http-client';
import { endpoints } from '@/lib/api/endpoints';
import type { PlaylistTrackPrimitive } from '@/types/api';

/**
 * useReorderTracks (REQ-FE-015; LOCKED design R6).
 *
 * POST /playlists/:id/reorder { from, to } → 200 PlaylistTrackPrimitive[]
 * (NOT 201 — backend @HttpCode(200), PR-2 fix `619c7c8`). Insert-and-shift is
 * atomic + server-side.
 *
 * R6 LOCK: the invalidation is `onSettled` (fires on both success + error),
 * NOT `onSuccess`. There is NO `onMutate` — NO optimistic UI. The
 * insert-and-shift algorithm is NOT reimplemented client-side; the server
 * stays the single source of truth. RTT is imperceptible on localhost
 * single-user demo, and the absence of client-side reorder logic removes a
 * whole class of cache/server divergence bugs.
 */
export interface ReorderTracksInput {
  id: string;
  from: number;
  to: number;
}

export function useReorderTracks() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, from, to }: ReorderTracksInput) =>
      httpClient.post<PlaylistTrackPrimitive[]>(
        endpoints.playlists.reorder(id),
        { from, to },
      ),
    onSettled: (_data, _error, { id }) => {
      qc.invalidateQueries({ queryKey: ['playlists', 'tracks', id] });
    },
  });
}
