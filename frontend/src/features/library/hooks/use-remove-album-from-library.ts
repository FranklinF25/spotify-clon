import { useMutation, useQueryClient } from '@tanstack/react-query';
import { httpClient } from '@/lib/api/http-client';
import { endpoints } from '@/lib/api/endpoints';

/**
 * useRemoveAlbumFromLibrary (REQ-FE-017; DESIGN §9.2).
 * DELETE /library/albums/:id → 204 (idempotent server-side: removing an
 * unsaved album is still success). onSuccess invalidates ONLY
 * `['library','albums']` — same cache discipline as the save mutation.
 */
export interface RemoveAlbumFromLibraryInput {
  id: string;
}

export function useRemoveAlbumFromLibrary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: RemoveAlbumFromLibraryInput) =>
      httpClient.delete<void>(endpoints.library.album(id)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['library', 'albums'] });
    },
  });
}
