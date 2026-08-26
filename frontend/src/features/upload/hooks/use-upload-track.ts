import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { httpClient } from '@/lib/api/http-client';
import { endpoints } from '@/lib/api/endpoints';
import type { UploadResult } from '@/types/api';

/**
 * useUploadTrack (REQ-UPLOAD-002) — the FEATURES-side orchestration seam for
 * ONE file transfer: `const upload = useUploadTrack(); await upload(file, onProgress)`.
 *
 * STATE-MANAGEMENT SHAPE (deliberate, documented per the F7 design note):
 * TanStack Query is KEPT OUT of the transfer itself. `useMutation` has no
 * per-call progress channel, and a page driving N SIMULTANEOUS files needs N
 * independent progress streams — one hook instance cannot host that without
 * inventing an id-keyed progress map that just re-implements the page's own
 * row state. So the division of labour is:
 *
 *   - `httpClient.uploadFile` (lib) — the raw XHR transfer + wire contract.
 *   - THIS hook — a stable `start(file, onProgress)` callback + the
 *     cache-invalidation side effect that only TanStack should own.
 *   - `UploadPage` — a `useReducer` row list (id → progress/status/result),
 *     the classic "list of async jobs" reducer; one row per file, parallel
 *     transfers via Promise.allSettled at the call site.
 *
 * On success it invalidates the CATALOG read-cache ROOTS a fresh track can
 * stale (grep-derived, prefix-matched by TanStack):
 *   - ['search']   ← use-search `['search', q, type]` — "immediately
 *                    findable in search" is the F7 acceptance line.
 *   - ['albums']   ← use-albums `['albums','list',input]` + use-album
 *                    `['albums','detail',id]` (detail embeds the track list;
 *                    a new album can appear in the featured grid).
 *   - ['artists']  ← use-artist `['artists','detail',id]` (detail embeds
 *                    albums — an upload can mint a brand-new artist/album).
 * NOT invalidated: ['playlists'] and ['library'] — those cache USER
 * relations (playlist rows, saved-album relations) that a catalog write
 * cannot change; invalidating them would only buy a spurious refetch.
 *
 * Progress note: `onProgress` is a 0..1 fraction forwarded from XHR
 * `upload.onprogress` (lengthComputable only — see http-client.uploadFile).
 */
export function useUploadTrack() {
  const qc = useQueryClient();
  return useCallback(
    async (file: File, onProgress?: (fraction: number) => void) => {
      const result = await httpClient.uploadFile<UploadResult>(
        endpoints.tracks.upload,
        file,
        { onProgress },
      );
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['search'] }),
        qc.invalidateQueries({ queryKey: ['albums'] }),
        qc.invalidateQueries({ queryKey: ['artists'] }),
      ]);
      return result;
    },
    [qc],
  );
}
