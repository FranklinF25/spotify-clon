import { httpClient } from '@/lib/api/http-client';
import { endpoints } from '@/lib/api/endpoints';

/**
 * Blob-URL audio source (DESIGN §6.3, REQ-FE-012).
 *
 * Fetches the JWT-guarded stream through `httpClient.getBlob` — NOT raw
 * `fetch` and NOT `httpClient.get<Blob>`. Two reasons it has to be `getBlob`:
 *  1. Audio 401 is structurally identical to every other endpoint's 401
 *     (token expired, cookie valid). Routing through `httpClient` means the
 *     single-flight refresh + retry-once path (§6.1) handles audio 401s
 *     automatically, instead of PlayerBar inventing a parallel refresh path.
 *  2. The binary mp3 body CANNOT go through `request<T>`'s `await res.text()`
 *     + `JSON.parse` — that UTF-8-decodes (destroys) the bytes and throws.
 *     TypeScript erases types at RUNTIME, so `request<T>` cannot branch on
 *     `T === Blob` — the dedicated `getBlob` (§6.1) is the real source of
 *     truth and calls `await res.blob()`.
 *
 * The Bearer header is injected by `httpClient` from `authStore` (single
 * source of truth); `loadBlobSource` does NOT take an `accessToken` param
 * (regression: the old signature took it and `void`-ed it). The response Blob
 * is wrapped in an object URL.
 *
 * Revoke responsibility is the CALLER's (PR-4 `useAudioSource`) — this
 * function only creates. `signal` lets the caller abort an in-flight stream
 * download on track change / unmount so rapid skips don't keep downloading
 * the whole previous track.
 */
export async function loadBlobSource(
  trackId: string,
  signal?: AbortSignal,
): Promise<string> {
  const blob = await httpClient.getBlob(endpoints.tracks.stream(trackId), {
    signal,
  });
  return URL.createObjectURL(blob);
}
