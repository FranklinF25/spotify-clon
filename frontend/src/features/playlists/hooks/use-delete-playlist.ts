import { useMutation, useQueryClient } from '@tanstack/react-query';
import { httpClient } from '@/lib/api/http-client';
import { endpoints } from '@/lib/api/endpoints';

/**
 * useDeletePlaylist (REQ-FE-014). DELETE /playlists/:id → 204 (FK CASCADE
 * clears tracks). onSuccess invalidates `['playlists','list']` so the card
 * disappears. The caller navigates to /playlists (the page owns the nav).
 */
export interface DeletePlaylistInput {
  id: string;
}

export function useDeletePlaylist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: DeletePlaylistInput) =>
      httpClient.delete<void>(endpoints.playlists.remove(id)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['playlists', 'list'] });
    },
  });
}
