import { useMutation, useQueryClient } from '@tanstack/react-query';
import { httpClient } from '@/lib/api/http-client';
import { endpoints } from '@/lib/api/endpoints';
import type { PlaylistPrimitive } from '@/types/api';

/**
 * useRenamePlaylist (REQ-FE-014/015). PATCH /playlists/:id { title } → 200.
 * onSuccess invalidates BOTH detail + list — the card title in the list may
 * have changed alongside the detail header.
 */
export interface RenamePlaylistInput {
  id: string;
  title: string;
}

export function useRenamePlaylist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, title }: RenamePlaylistInput) =>
      httpClient.patch<PlaylistPrimitive>(endpoints.playlists.rename(id), {
        title,
      }),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ['playlists', 'detail', id] });
      qc.invalidateQueries({ queryKey: ['playlists', 'list'] });
    },
  });
}
