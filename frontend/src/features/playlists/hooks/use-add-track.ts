import { useMutation, useQueryClient } from '@tanstack/react-query';
import { httpClient } from '@/lib/api/http-client';
import { endpoints } from '@/lib/api/endpoints';
import type { PlaylistTrackPrimitive } from '@/types/api';

/**
 * useAddTrack (REQ-FE-015). POST /playlists/:id/tracks { trackId } → 201.
 * Unknown trackId → 422 UNPROCESSABLE_ENTITY (typed end-to-end via ApiErrorCode).
 * onSuccess invalidates `['playlists','tracks',id]`.
 */
export interface AddTrackInput {
  id: string;
  trackId: string;
}

export function useAddTrack() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, trackId }: AddTrackInput) =>
      httpClient.post<PlaylistTrackPrimitive>(
        endpoints.playlists.addTrack(id),
        { trackId },
      ),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ['playlists', 'tracks', id] });
    },
  });
}
