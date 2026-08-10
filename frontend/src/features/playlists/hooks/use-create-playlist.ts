import { useMutation, useQueryClient } from '@tanstack/react-query';
import { httpClient } from '@/lib/api/http-client';
import { endpoints } from '@/lib/api/endpoints';
import type { PlaylistPrimitive } from '@/types/api';

/**
 * useCreatePlaylist (REQ-FE-014). POST /playlists { title } → 201.
 * onSuccess invalidates `['playlists','list']` so the new card appears.
 */
export interface CreatePlaylistInput {
  title: string;
}

export function useCreatePlaylist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePlaylistInput) =>
      httpClient.post<PlaylistPrimitive>(endpoints.playlists.create, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['playlists', 'list'] });
    },
  });
}
