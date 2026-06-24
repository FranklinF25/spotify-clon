import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw/server';
import { endpoints } from '@/lib/api/endpoints';
import { useAuthStore } from '@/store/auth.store';
import { ApiError } from '@/lib/api/http-client';
import { loadBlobSource } from './blob-source';

/**
 * Strict-TDD spec for the Blob-URL audio seam (DESIGN §6.3). Asserts the
 * contract `loadBlobSource` guarantees its single caller (PR-4 useAudioSource):
 *  - returns a `blob:` URL minted from a Blob (NOT text)
 *  - routes through httpClient.getBlob (NOT raw fetch / get<Blob>) so a stream
 *    401 shares the single-flight refresh path
 *  - threads the AbortSignal to fetch so a skip/unmount cancels the download
 */
const STREAM = '/api/v1/tracks/:id/stream';
const REFRESH = endpoints.auth.refresh;

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => {
  // setup.ts installs a global URL.createObjectURL stub; clear its call record
  // between tests so per-test assertions are exact.
  vi.mocked(URL.createObjectURL).mockClear();
});
afterEach(() => {
  server.resetHandlers();
  useAuthStore.setState({ accessToken: null });
  vi.restoreAllMocks();
});
afterAll(() => server.close());

describe('loadBlobSource', () => {
  it('returns a blob: URL minted from a Blob (NOT text)', async () => {
    useAuthStore.setState({ accessToken: 'token-T' });
    const url = await loadBlobSource('T1');
    expect(url.startsWith('blob:')).toBe(true);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    const [arg] = vi.mocked(URL.createObjectURL).mock.calls[0];
    expect(arg).toBeInstanceOf(Blob);
  });

  it('a stream 401 shares the single-flight refresh path (exactly one refresh + retry)', async () => {
    useAuthStore.setState({ accessToken: 'expired' });
    let streamAttempts = 0;
    server.use(
      http.get(STREAM, () => {
        streamAttempts++;
        if (streamAttempts === 1) {
          return HttpResponse.json(
            { error: { code: 'UNAUTHORIZED', message: 'expired' } },
            { status: 401 },
          );
        }
        return new HttpResponse(new Uint8Array([10, 20, 30]), {
          headers: { 'content-type': 'audio/mpeg' },
        });
      }),
    );
    let refreshCalls = 0;
    server.use(
      http.post(REFRESH, () => {
        refreshCalls++;
        return HttpResponse.json({ accessToken: 'fresh' });
      }),
    );

    const url = await loadBlobSource('T9');
    expect(url.startsWith('blob:')).toBe(true);
    expect(streamAttempts).toBe(2); // initial 401 + one retry
    expect(refreshCalls).toBe(1); // exactly one refresh across the audio path
  });

  it('non-ok-after-retry throws ApiError', async () => {
    useAuthStore.setState({ accessToken: 'token-T' });
    server.use(
      http.get(STREAM, () =>
        HttpResponse.json(
          { error: { code: 'NOT_FOUND', message: 'gone' } },
          { status: 404 },
        ),
      ),
    );
    await expect(loadBlobSource('nope')).rejects.toBeInstanceOf(ApiError);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('threads the AbortSignal to fetch and rejects when aborted', async () => {
    useAuthStore.setState({ accessToken: 'token-T' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const controller = new AbortController();

    const pending = loadBlobSource('T1', controller.signal);
    // The fetch for the stream carried our signal.
    const streamCall = fetchSpy.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('/stream'),
    );
    expect(streamCall).toBeDefined();
    const opts = streamCall![1] as RequestInit;
    expect(opts.signal).toBe(controller.signal);

    controller.abort();
    await expect(pending).rejects.toBeDefined();
    // No URL minted on failure.
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});
