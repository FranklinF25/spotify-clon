import { useEffect, useState } from 'react';
import { useAuthStore } from '@/store/auth.store';
import { usePlayerStore } from '@/store/player.store';
import { loadBlobSource } from '@/lib/audio/blob-source';

/**
 * useAudioSource (REQ-FE-012, DESIGN §5.2 + §6.3).
 *
 * Returns the current Blob URL (or null) + owns its lifecycle. Co-located
 * with `PlayerBar` per JD fix #9 — no component imports from `features/`.
 * Enforces the six Blob-URL lifecycle invariants (DESIGN §6.3):
 *   1. one active blob URL per PlayerBar instance (one-track → one-URL),
 *   2. revoke on track change,
 *   3. revoke on unmount,
 *   4. no double-revoke (`revoked` race guard),
 *   5. no leak on fetch failure (`catch` mints no URL),
 *   6. PlayerBar mounted once (enforced structurally by AppLayout —
 *      FE-PR4-04's runtime single-mount test).
 *
 * The latest access token is read IMPERATIVELY from `authStore.getState()`
 * inside the effect — it is NOT a dep. A re-fetch on token rotation would
 * orphan a perfectly valid blob URL mid-playback (JD fix #7). The blob
 * URL is valid for the track's lifetime; `httpClient.getBlob` reads the
 * live token from the store, so accepting one as a parameter would be a
 * dead/misleading arg (regression: the old signature took it + void-ed it).
 *
 * The dep array is `[currentTrack?.id]` ONLY. The `AbortController` lets a
 * rapid skip / track change abort the in-flight mp3 download instead of
 * fetching a whole previous track the user has already moved past.
 */
export function useAudioSource(): string | null {
  // currentTrack = the queue entry at currentIndex, or null when the queue
  // is empty / currentIndex is -1.
  const currentTrack = usePlayerStore((s) =>
    s.currentIndex >= 0 ? s.queue[s.currentIndex] ?? null : null,
  );
  // Pull the id out of the optional chaining — writing it as a local keeps
  // the deps array literal plain (optional chaining in the literal trips
  // eslint-plugin-react-hooks@4.6.2 on ESLint 9). The semantics are
  // identical: the effect re-runs whenever the id changes.
  const currentTrackId = currentTrack?.id;
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!currentTrackId) {
      setSrc(null);
      return;
    }
    // Read the token imperatively — NOT a dep (see header comment).
    // httpClient.getBlob re-reads it; we only check presence here to avoid
    // a doomed fetch when there is clearly no session.
    const { accessToken } = useAuthStore.getState();
    if (!accessToken) {
      setSrc(null);
      return;
    }

    let revoked = false; // race guard — blocks double-revoke (invariant #4)
    let createdUrl: string | null = null;
    const controller = new AbortController();

    loadBlobSource(currentTrackId, controller.signal)
      .then((url) => {
        if (revoked) {
          // Cleanup already ran — the URL we just minted is orphaned;
          // revoke it immediately so it does not leak (invariant #4).
          URL.revokeObjectURL(url);
          return;
        }
        createdUrl = url;
        setSrc(url);
      })
      .catch(() => {
        // No leak on fetch failure (invariant #5): nothing was minted.
        if (!revoked) setSrc(null);
      });

    return () => {
      // Runs on track change (currentTrackId changed) AND on unmount.
      revoked = true;
      controller.abort(); // cancel any in-flight stream download
      if (createdUrl) {
        URL.revokeObjectURL(createdUrl); // revoke-on-track-change + unmount
        createdUrl = null;
      }
    };
  }, [currentTrackId]);

  return src;
}
