import { useMutation, useQueryClient } from '@tanstack/react-query';
import { httpClient } from '@/lib/api/http-client';
import { endpoints } from '@/lib/api/endpoints';

/**
 * useRemoveTrack (REQ-FE-015). DELETE /playlists/:id/tracks/:position → 204
 * (compact-on-remove server-side). onSuccess invalidates
 * `['playlists','tracks',id]`; the refetch renders the compacted positions.
 */
export interface RemoveTrackInput {
  id: string;
  position: number;
}

export function useRemoveTrack() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, position }: RemoveTrackInput) =>
      httpClient.delete<void>(
        endpoints.playlists.removeTrack(id, position),
      ),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ['playlists', 'tracks', id] });
    },
  });
}
