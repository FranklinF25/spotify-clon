import { useMutation, useQueryClient } from '@tanstack/react-query';
import { httpClient } from '@/lib/api/http-client';
import { endpoints } from '@/lib/api/endpoints';

/**
 * useAddAlbumToLibrary (REQ-FE-017; DESIGN §9.2). POST /library/albums/:id
 * → 204 (upsert: re-saving resets addedAt, never 409). onSuccess
 * invalidates ONLY `['library','albums']` — album data itself did not
 * change, so `['albums','detail',id]` is deliberately NOT invalidated
 * (D-fe-3: the saved flag is derived from the single library cache).
 */
export interface AddAlbumToLibraryInput {
  id: string;
}

export function useAddAlbumToLibrary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: AddAlbumToLibraryInput) =>
      httpClient.post<void>(endpoints.library.album(id)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['library', 'albums'] });
    },
  });
}
