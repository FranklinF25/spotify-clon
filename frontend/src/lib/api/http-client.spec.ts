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
import { FakeXMLHttpRequest } from '@/test/fakes/fake-xml-http-request';
import type { UploadResult } from '@/types/api';
import {
  ApiError,
  httpClient,
  setBootRefreshGate,
} from './http-client';

/**
 * Strict-TDD spec for the typed HTTP client (DESIGN §6.1 — the portfolio
 * payload). Covers: Bearer inject, zod-envelope parse, malformed-envelope +
 * HTML-body fallback to GENERIC, single-flight refresh, refresh-401 clear+
 * redirect, R2-2b (refreshPromise always cleared in try/finally), R2-2a
 * (skipAuthRefresh bypasses the boot gate), getBlob binary path + its own
 * single-flight + AbortSignal threading.
 */
const ALBUMS = endpoints.albums.list().replace(/\?.*$/, '');
const REFRESH = endpoints.auth.refresh;

/**
 * The jsdom `Location`'s `assign` is frozen (writable:false, configurable:false),
 * and MSW resolves relative request URLs against `window.location.href`. So to
 * observe doRefresh's redirect WITHOUT breaking fetch resolution, we replace
 * `window.location` (a configurable accessor on `window`) with a full stub
 * carrying a valid `href` + a mock `assign`. `nativeLocation` is restored in
 * afterEach so other specs see the real Location.
 */
const nativeLocation = window.location;

function mockLocationAssign(pathname = '/') {
  const assign = vi.fn();
  const href = `http://localhost${pathname}`;
  Object.defineProperty(window, 'location', {
    value: {
      href,
      origin: 'http://localhost',
      protocol: 'http:',
      host: 'localhost',
      hostname: 'localhost',
      port: '',
      pathname,
      search: '',
      hash: '',
      assign,
      replace: vi.fn(),
      reload: vi.fn(),
      toString: () => href,
    },
    configurable: true,
    writable: true,
  });
  return assign;
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  setBootRefreshGate(null);
  useAuthStore.setState({ accessToken: null });
  Object.defineProperty(window, 'location', {
    value: nativeLocation,
    configurable: true,
    writable: true,
  });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  FakeXMLHttpRequest.reset();
});
afterAll(() => server.close());

describe('httpClient — Bearer header inject (REQ-FE-002)', () => {
  it('attaches Authorization: Bearer <accessToken> from the auth store', async () => {
    useAuthStore.setState({ accessToken: 'token-T' });
    let observedAuth: string | null = null;
    server.use(
      http.get(endpoints.me, ({ request }) => {
        observedAuth = request.headers.get('authorization');
        return HttpResponse.json({ id: 'u1', email: 'a@b.co', displayName: 'A' });
      }),
    );
    await httpClient.get(endpoints.me);
    expect(observedAuth).toBe('Bearer token-T');
  });

  it('omits the Authorization header when no token is set', async () => {
    useAuthStore.setState({ accessToken: null });
    let observedAuth: string | null = 'unchanged';
    server.use(
      http.get(endpoints.me, ({ request }) => {
        observedAuth = request.headers.get('authorization');
        return HttpResponse.json({ id: 'u1', email: 'a@b.co', displayName: 'A' });
      }),
    );
    await httpClient.get(endpoints.me);
    expect(observedAuth).toBeNull();
  });
});

describe('httpClient — error envelope parsing (REQ-FE-002)', () => {
  it('parses a 400 VALIDATION_ERROR envelope into a typed ApiError with details', async () => {
    server.use(
      http.get(endpoints.me, () =>
        HttpResponse.json(
          {
            error: {
              code: 'VALIDATION_ERROR',
              message: 'bad input',
              details: [{ field: 'email', issue: 'invalid_format' }],
            },
          },
          { status: 400 },
        ),
      ),
    );
    try {
      await httpClient.get(endpoints.me);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      const err = e as ApiError;
      expect(err.code).toBe('VALIDATION_ERROR');
      expect(err.status).toBe(400);
      expect(err.details[0].field).toBe('email');
      expect(err.details[0].issue).toBe('invalid_format');
    }
  });

  it('falls through to GENERIC for a malformed envelope body {error:7}', async () => {
    server.use(
      http.get(endpoints.me, () =>
        HttpResponse.json({ error: 7 }, { status: 400 }),
      ),
    );
    try {
      await httpClient.get(endpoints.me);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).code).toBe('UNKNOWN');
      expect((e as ApiError).status).toBe(400);
    }
  });

  it('returns GENERIC (UNKNOWN) for a non-JSON HTML 502 body — no SyntaxError leaks', async () => {
    server.use(
      http.get(endpoints.me, () =>
        new HttpResponse('<html><body>Bad Gateway</body></html>', {
          status: 502,
          headers: { 'content-type': 'text/html' },
        }),
      ),
    );
    try {
      await httpClient.get(endpoints.me);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).code).toBe('UNKNOWN');
      expect((e as ApiError).status).toBe(502);
      // The SyntaxError from JSON.parse must NOT propagate to the caller.
      expect(e).not.toBeInstanceOf(SyntaxError);
    }
  });

  it('treats 204 as no-content (returns undefined)', async () => {
    server.use(http.post(endpoints.auth.logout, () => new HttpResponse(null, { status: 204 })));
    const result = await httpClient.post(endpoints.auth.logout, {});
    expect(result).toBeUndefined();
  });
});

describe('httpClient — single-flight 401 refresh (REQ-FE-003)', () => {
  it('3 concurrent 401s share exactly one /auth/refresh and each retries once with the new token', async () => {
    useAuthStore.setState({ accessToken: 'expired' });
    let catalogAttempts = 0;
    const seenTokens: string[] = [];
    server.use(
      http.get(ALBUMS, ({ request }) => {
        catalogAttempts++;
        seenTokens.push(request.headers.get('authorization') ?? 'none');
        // First 3 attempts (initial) 401; retries (attempts 4,5,6) succeed.
        if (catalogAttempts <= 3) {
          return HttpResponse.json(
            { error: { code: 'UNAUTHORIZED', message: 'expired' } },
            { status: 401 },
          );
        }
        return HttpResponse.json({ items: [], total: 0, page: 1, pageSize: 20 });
      }),
    );
    let refreshCalls = 0;
    server.use(
      http.post(REFRESH, () => {
        refreshCalls++;
        return HttpResponse.json({ accessToken: 'fresh-token' });
      }),
    );

    const results = await Promise.all([
      httpClient.get(ALBUMS),
      httpClient.get(ALBUMS),
      httpClient.get(ALBUMS),
    ]);

    expect(refreshCalls).toBe(1); // single-flight
    expect(results).toHaveLength(3);
    // The retried requests (attempts 4-6) carried the fresh token.
    expect(seenTokens.slice(3)).toEqual([
      'Bearer fresh-token',
      'Bearer fresh-token',
      'Bearer fresh-token',
    ]);
    // authStore hydrated with the new token.
    expect(useAuthStore.getState().accessToken).toBe('fresh-token');
  });

  it('refresh-401 clears the store, redirects to /login, and queued requests are NOT retried', async () => {
    useAuthStore.setState({ accessToken: 'expired', status: 'authenticated', user: { id: 'u', email: 'a@b.co', displayName: 'A' } });
    const assign = mockLocationAssign();
    server.use(
      http.get(ALBUMS, () =>
        HttpResponse.json(
          { error: { code: 'UNAUTHORIZED', message: 'expired' } },
          { status: 401 },
        ),
      ),
    );
    server.use(
      http.post(REFRESH, () =>
        HttpResponse.json(
          { error: { code: 'UNAUTHORIZED', message: 'cookie gone' } },
          { status: 401 },
        ),
      ),
    );

    await expect(httpClient.get(ALBUMS)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });

    // Store cleared (REQ-FE-003 "Refresh-401 clears the store").
    const s = useAuthStore.getState();
    expect(s.status).toBe('unauthenticated');
    expect(s.accessToken).toBeNull();
    expect(s.user).toBeNull();
    // Redirect issued.
    expect(assign).toHaveBeenCalledWith('/login');
  });

  it('refresh-401 skips the redirect when already on /login', async () => {
    useAuthStore.setState({ accessToken: 'expired' });
    const assign = mockLocationAssign('/login');
    server.use(
      http.get(ALBUMS, () =>
        HttpResponse.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 }),
      ),
    );
    server.use(
      http.post(REFRESH, () =>
        HttpResponse.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 }),
      ),
    );
    await expect(httpClient.get(ALBUMS)).rejects.toBeInstanceOf(ApiError);
    expect(assign).not.toHaveBeenCalled();
  });

  it('R2-2b: refreshPromise is cleared after a rejecting refresh — a second 401 starts a FRESH doRefresh', async () => {
    useAuthStore.setState({ accessToken: 'expired' });
    let refreshCalls = 0;
    server.use(
      http.post(REFRESH, () => {
        refreshCalls++;
        // First refresh: network reject (exercises the try/finally null path).
        if (refreshCalls === 1) return Response.error();
        return HttpResponse.json({ accessToken: 'fresh-2' });
      }),
    );
    server.use(
      http.get(ALBUMS, () =>
        HttpResponse.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 }),
      ),
    );

    // Wave 1: refresh rejects → request rejects.
    await expect(httpClient.get(ALBUMS)).rejects.toBeDefined();
    expect(refreshCalls).toBe(1);

    // Wave 2: a fresh 401 MUST start a NEW doRefresh (refreshCalls → 2).
    // If refreshPromise were stuck-as-rejected, wave 2 would await the cached
    // rejection and doRefresh would NOT fire again (refreshCalls stays 1).
    await expect(httpClient.get(ALBUMS)).rejects.toBeDefined();
    expect(refreshCalls).toBe(2); // ← proves the gate was cleared in finally
  });

  it('401 AFTER a successful refresh surfaces UNAUTHORIZED (single retry, no loop)', async () => {
    useAuthStore.setState({ accessToken: 'expired' });
    let refreshCalls = 0;
    let catalogAttempts = 0;
    server.use(
      http.post(REFRESH, () => {
        refreshCalls++;
        return HttpResponse.json({ accessToken: 'fresh' });
      }),
    );
    server.use(
      http.get(ALBUMS, () => {
        catalogAttempts++;
        // Always 401 — even after the retry with the fresh token. Full
        // envelope (with message) so the parse yields UNAUTHORIZED, matching
        // the real backend 401 body.
        return HttpResponse.json(
          { error: { code: 'UNAUTHORIZED', message: 'invalid token' } },
          { status: 401 },
        );
      }),
    );

    await expect(httpClient.get(ALBUMS)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    // Exactly one refresh, exactly two catalog attempts (initial + one retry).
    expect(refreshCalls).toBe(1);
    expect(catalogAttempts).toBe(2);
  });
});

describe('httpClient — boot gate (R2-2a no self-deadlock)', () => {
  it('a guarded request awaits a pending bootRefreshGate', async () => {
    let gateResolve!: () => void;
    const gate = new Promise<void>((r) => {
      gateResolve = r;
    });
    setBootRefreshGate(gate);

    let resolved = false;
    void httpClient.get(endpoints.me).then(() => {
      resolved = true;
    });
    // Let the microtask queue flush; the request must still be parked.
    await new Promise((r) => setTimeout(r, 30));
    expect(resolved).toBe(false);

    gateResolve();
    await new Promise((r) => setTimeout(r, 10));
    expect(resolved).toBe(true);
  });

  it('skipAuthRefresh:true bypasses the boot gate (issues immediately)', async () => {
    // Gate intentionally NEVER resolved — if skipAuthRefresh were ignored,
    // this request would hang until the test times out.
    setBootRefreshGate(new Promise<void>(() => {}));

    const result = await httpClient.get(endpoints.me, {
      skipAuthRefresh: true,
    });
    // Resolved despite the gate being permanently pending.
    expect((result as { id: string }).id).toBeDefined();
  });
});

describe('httpClient.getBlob — binary audio path', () => {
  it('returns a Blob (NOT text) for the stream endpoint', async () => {
    useAuthStore.setState({ accessToken: 'token-T' });
    const blob = await httpClient.getBlob(endpoints.tracks.stream('T1'));
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe('audio/mpeg');
  });

  it('a 401 on the stream triggers single-flight refresh + retry (audio shares the path)', async () => {
    useAuthStore.setState({ accessToken: 'expired' });
    let streamAttempts = 0;
    server.use(
      http.get('/api/v1/tracks/:id/stream', () => {
        streamAttempts++;
        if (streamAttempts === 1) {
          return HttpResponse.json(
            { error: { code: 'UNAUTHORIZED' } },
            { status: 401 },
          );
        }
        return new HttpResponse(new Uint8Array([1, 2, 3, 4]), {
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

    const blob = await httpClient.getBlob(endpoints.tracks.stream('T1'));
    expect(blob).toBeInstanceOf(Blob);
    expect(streamAttempts).toBe(2); // initial 401 + one retry
    expect(refreshCalls).toBe(1); // exactly one refresh across the audio path
  });

  it('non-ok-after-retry throws ApiError', async () => {
    useAuthStore.setState({ accessToken: 'expired' });
    server.use(
      http.get('/api/v1/tracks/:id/stream', () =>
        HttpResponse.json({ error: { code: 'NOT_FOUND' } }, { status: 404 }),
      ),
    );
    await expect(
      httpClient.getBlob(endpoints.tracks.stream('nope')),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it('threads the AbortSignal through to fetch', async () => {
    useAuthStore.setState({ accessToken: 'token-T' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const controller = new AbortController();
    // Issue (don't await) so we can inspect the call args immediately.
    const pending = httpClient.getBlob(endpoints.tracks.stream('T1'), {
      signal: controller.signal,
    });
    // The last fetch call (the GET to stream) carried our signal.
    const streamCall = fetchSpy.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('/stream'),
    );
    expect(streamCall).toBeDefined();
    const opts = streamCall![1] as RequestInit;
    expect(opts.signal).toBe(controller.signal);
    controller.abort();
    await expect(pending).rejects.toBeDefined();
  });
});

/**
 * F7 — httpClient.uploadFile: the multipart XHR path (REQ-UPLOAD-001/002).
 * Transport is the FakeXMLHttpRequest (MSW cannot emit upload.onprogress
 * events); the doRefresh leg of the 401 test below runs on REAL fetch + MSW,
 * proving the XHR path shares the fetch path's single-flight refresh.
 */
const UPLOAD = endpoints.tracks.upload;
const UPLOAD_FILE = new File([new Uint8Array(512)], 'song.mp3', {
  type: 'audio/mpeg',
});
const UPLOAD_CONTRACT: UploadResult = {
  track: {
    id: 'track-001',
    title: 'Nightcall',
    durationSeconds: 250,
    albumId: 'album-001',
  },
  artist: { id: 'artist-001', name: 'Kavinsky' },
  album: { id: 'album-001', title: 'OutRun' },
};

describe('httpClient.uploadFile — multipart XHR path (REQ-UPLOAD-002)', () => {
  beforeEach(() => {
    FakeXMLHttpRequest.reset();
    vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest);
    useAuthStore.setState({ accessToken: 'token-T' });
  });

  it('POSTs multipart field "file" with Bearer + credentials', async () => {
    const p = httpClient.uploadFile<UploadResult>(UPLOAD, UPLOAD_FILE);
    const xhr = FakeXMLHttpRequest.sent[0]!;
    expect(xhr.method).toBe('POST');
    expect(xhr.url).toBe(UPLOAD);
    expect(xhr.headers['Authorization']).toBe('Bearer token-T');
    expect(xhr.withCredentials).toBe(true);
    expect(xhr.body).toBeInstanceOf(FormData);
    // FormData.append(name, blob, filename) re-wraps a Blob into a NEW File
    // (HTML spec), so identity is gone — assert the wire facts instead.
    const sent = (xhr.body as FormData).get('file') as File;
    expect(sent).toBeInstanceOf(File);
    expect(sent.name).toBe('song.mp3');
    expect(sent.size).toBe(UPLOAD_FILE.size);
    xhr.respond(201, UPLOAD_CONTRACT);
    await expect(p).resolves.toEqual(UPLOAD_CONTRACT);
  });

  it('maps lengthComputable progress to a 0..1 fraction, clamped at 1', async () => {
    const onProgress = vi.fn();
    const p = httpClient.uploadFile<UploadResult>(UPLOAD, UPLOAD_FILE, {
      onProgress,
    });
    const xhr = FakeXMLHttpRequest.sent[0]!;
    xhr.emitProgress(0.5);
    xhr.emitProgress(1.75); // loaded beyond total must clamp, never exceed 1
    xhr.respond(201, UPLOAD_CONTRACT);
    await p;
    expect(onProgress).toHaveBeenNthCalledWith(1, 0.5);
    expect(onProgress).toHaveBeenNthCalledWith(2, 1);
  });

  it('parses a 400 VALIDATION_ERROR envelope into a typed ApiError with details', async () => {
    const p = httpClient.uploadFile<UploadResult>(UPLOAD, UPLOAD_FILE);
    FakeXMLHttpRequest.sent[0]!.respond(400, {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'File upload was rejected',
        details: [{ field: 'file', issue: 'unsupported file extension .exe' }],
      },
    });
    await expect(p).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 400,
      details: [{ field: 'file', issue: 'unsupported file extension .exe' }],
    });
  });

  it('falls through to GENERIC for an HTML 400 body — no SyntaxError leaks', async () => {
    const p = httpClient.uploadFile<UploadResult>(UPLOAD, UPLOAD_FILE);
    FakeXMLHttpRequest.sent[0]!.respond(400, '<html><body>Bad</body></html>');
    const rejection = await p.then(
      () => null,
      (e: unknown) => e,
    );
    expect(rejection).toBeInstanceOf(ApiError);
    expect((rejection as ApiError).code).toBe('UNKNOWN');
    expect((rejection as ApiError).status).toBe(400);
  });

  it('a network failure (no status) rejects as UNKNOWN', async () => {
    const p = httpClient.uploadFile<UploadResult>(UPLOAD, UPLOAD_FILE);
    FakeXMLHttpRequest.sent[0]!.fireError();
    await expect(p).rejects.toMatchObject({ code: 'UNKNOWN', status: 0 });
  });

  it('a 401 shares the single-flight refresh and retries ONCE with the fresh token', async () => {
    useAuthStore.setState({ accessToken: 'expired' });
    let refreshCalls = 0;
    server.use(
      http.post(REFRESH, () => {
        refreshCalls++;
        return HttpResponse.json({ accessToken: 'fresh-token' });
      }),
    );

    const p = httpClient.uploadFile<UploadResult>(UPLOAD, UPLOAD_FILE);
    FakeXMLHttpRequest.sent[0]!.respond(
      401,
      { error: { code: 'UNAUTHORIZED', message: 'expired' } },
    );
    // The retry lands on a SECOND XHR after the (real-fetch) refresh settles.
    await vi.waitFor(() =>
      expect(FakeXMLHttpRequest.sent).toHaveLength(2),
    );
    const retry = FakeXMLHttpRequest.sent[1]!;
    expect(retry.headers['Authorization']).toBe('Bearer fresh-token');
    retry.respond(201, UPLOAD_CONTRACT);

    await expect(p).resolves.toEqual(UPLOAD_CONTRACT);
    expect(refreshCalls).toBe(1); // single-flight shared with fetch callers
    expect(useAuthStore.getState().accessToken).toBe('fresh-token');
  });
});
