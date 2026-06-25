import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import { resetStores } from './resetStores';

/**
 * Vitest global setup (DESIGN §10). Loaded once per test file via
 * `setupFiles` in vite.config.ts.
 *
 * - `@testing-library/jest-dom/vitest` augments `expect` with DOM matchers
 *   (`toBeInTheDocument`, `toHaveAttribute`, ...).
 * - `afterEach` runs RTL `cleanup` (unmounts rendered components) +
 *   `resetStores` (zeroes authStore + localStorage) so each test starts clean.
 * - URL.createObjectURL/revokeObjectURL stubs: jsdom does not implement them;
 *   the blob path (FE-PR1-10 `loadBlobSource`, PR-4 `useAudioSource`) needs
 *   them. Deterministic `blob:` URLs so revoke assertions can distinguish.
 * - AbortSignal/fetch compatibility wrap (see `patchFetchForAbortSignal`):
 *   PR-4's `useAudioSource` threads an AbortController through `loadBlobSource`
 *   → `httpClient.getBlob` → `fetch`. In production (real browser) the native
 *   AbortController matches browser fetch. Under jsdom, jsdom provides its
 *   OWN AbortController polyfill whose signal is NOT recognized by Node's
 *   undici fetch OR by `@mswjs/interceptors` (which wraps fetch when MSW's
 *   `server.listen()` runs). The wrap strips the signal class check
 *   TEST-ENV-ONLY so the audio-path specs can exercise the seam.
 */

/**
 * Wrap `globalThis.fetch` so an AbortSignal in `init` does not crash MSW's
 * fetch interceptor / undici with a class-identity mismatch under jsdom.
 * Behaviour preserved:
 *   - `init.signal` is still recorded in the call args (spies see it).
 *   - a pre-aborted signal rejects with an AbortError-shaped DOMException,
 *     mirroring native semantics (used by the existing blob-source abort spec).
 *   - a not-yet-aborted signal is stripped before the real fetch so the
 *     request actually issues (jsdom's polyfilled signal class is the ONLY
 *     thing incompatible; the request itself is fine).
 *   - mid-flight abort still rejects the outer promise with an AbortError
 *     (we race the fetch against the signal's `abort` event; we can't
 *     truly cancel undici without a recognized signal, but the rejection
 *     semantics match native for tests that assert `rejects.toBeDefined()`).
 * Production code is unchanged (real browsers do not install this wrap;
 * their AbortController matches their fetch natively).
 */
function patchFetchForAbortSignal(): void {
  const currentFetch = globalThis.fetch;
  // Idempotent: if we've already wrapped this exact function, do not re-wrap.
  // (We re-run on every beforeEach because MSW's `server.listen()` in a spec
  // file's `beforeAll` overwrites `globalThis.fetch` AFTER this setup module
  // first loads.)
  if (
    typeof currentFetch === 'function' &&
    Object.hasOwn(currentFetch, '__abortSignalPatched'
  )) {
    return;
  }
  const nativeFetch = currentFetch;
  const wrapped = function fetchWithoutJSDOMSignalClass(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const signal = init?.signal;
    if (!signal) return nativeFetch(input, init);
    const abortError = () =>
      new DOMException('The user aborted a request.', 'AbortError');
    // Mirror native fetch: a pre-aborted signal rejects immediately.
    if (signal.aborted) return Promise.reject(abortError());
    // Strip the jsdom-polyfilled signal so undici's / MSW's `instanceof
    // AbortSignal` class-identity check passes. The signal stays in the
    // recorded call args (spies still see it); only the actual call is
    // sanitized.
    const sanitized: RequestInit = { ...init };
    delete (sanitized as { signal?: AbortSignal }).signal;
    const fetchP = nativeFetch(input, sanitized);
    // Race the real fetch against the signal's abort so a mid-flight
    // `controller.abort()` rejects the outer promise with AbortError (mirrors
    // native semantics — true cancel propagation to undici is impossible
    // without a class-recognized signal, but tests assert rejection only).
    return new Promise<Response>((resolve, reject) => {
      const onAbort = () => {
        reject(abortError());
      };
      signal.addEventListener('abort', onAbort, { once: true });
      fetchP.then(
        (res) => {
          signal.removeEventListener('abort', onAbort);
          resolve(res);
        },
        (err) => {
          signal.removeEventListener('abort', onAbort);
          reject(err);
        },
      );
    });
  } as typeof fetch;
  Object.defineProperty(wrapped, '__abortSignalPatched', {
    value: true,
    enumerable: false,
  });
  globalThis.fetch = wrapped;
}

// Install once at setup-module load (covers specs that don't use MSW).
patchFetchForAbortSignal();

// Re-install before every test: MSW's `server.listen()` in a spec's `beforeAll`
// overwrites `globalThis.fetch` AFTER this setup module first loads; layering
// the wrap on top of MSW's proxy lets both coexist.
beforeEach(patchFetchForAbortSignal);

// Distinct blob: URL per call so tests that swap tracks can distinguish the
// previous URL from the new one (the createObjectURL stub returns
// `blob:mock://<n>` — N increments per call). jsdom does not implement
// createObjectURL natively, so we own this seam entirely in tests.
let blobUrlSeq = 0;
URL.createObjectURL = vi.fn(() => `blob:mock://${++blobUrlSeq}`);
URL.revokeObjectURL = vi.fn();

afterEach(() => {
  cleanup();
  resetStores();
});
