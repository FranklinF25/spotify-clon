import { http, HttpResponse } from 'msw';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { endpoints } from '@/lib/api/endpoints';
import {
  buildAlbum,
  buildAlbumDetail,
  buildArtist,
  buildArtistDetail,
  buildSearchResult,
  buildTrack,
  buildUser,
  paginate,
} from '../fakes';

// Load the committed silent-mp3 fixture once (binary Blob for /stream).
// Vitest runs handlers in the node process, so node:fs is available. The
// FE-PR1-10 blob-source spec asserts the response is a Blob, and PR-4's
// useAudioSource feeds it to <audio> (jsdom does not decode it).
const __dirname = dirname(fileURLToPath(import.meta.url));
const sampleMp3 = readFileSync(
  resolve(__dirname, '../fixtures/audio/sample.mp3'),
);

/** Strip the query string — MSW matches the pathname; query is read in-handler. */
const basePath = (urlWithQuery: string): string => urlWithQuery.replace(/\?.*$/, '');

/**
 * MSW handlers for ALL twelve slice-A endpoints (REQ-FE-005 "Every slice-A
 * endpoint has an MSW handler"). `:id` path params are echoed into the
 * response so path-id matching is deterministic regardless of the fake
 * sequence counter.
 *
 * `/auth/refresh` returns `{ accessToken }` ONLY (no `user`) — matching
 * AuthController.refresh (DESIGN §4.1). The boot flow hydrates `user` via
 * the separate `/me` handler.
 */
export const handlers = [
  // --- Auth (F1) ---
  http.post(
    endpoints.auth.register,
    () =>
      HttpResponse.json(
        { accessToken: 'mock-access-token', user: buildUser() },
        { status: 201 },
      ),
  ),
  http.post(
    endpoints.auth.login,
    () =>
      HttpResponse.json({
        accessToken: 'mock-access-token',
        user: buildUser(),
      }),
  ),
  // refresh returns { accessToken } ONLY — NO `user`.
  http.post(
    endpoints.auth.refresh,
    () => HttpResponse.json({ accessToken: 'mock-access-token' }),
  ),
  http.post(endpoints.auth.logout, () => new HttpResponse(null, { status: 204 })),

  // --- Me ---
  http.get(endpoints.me, () => HttpResponse.json(buildUser())),

  // --- Artists (F2) ---
  http.get(basePath(endpoints.artists.list()), ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page') ?? 1);
    const pageSize = Number(url.searchParams.get('pageSize') ?? 20);
    return HttpResponse.json(
      paginate([buildArtist(), buildArtist()], page, pageSize),
    );
  }),
  http.get(
    endpoints.artists.detail(':id'),
    ({ params }) =>
      HttpResponse.json(buildArtistDetail({ id: String(params.id) })),
  ),

  // --- Albums (F2) ---
  http.get(basePath(endpoints.albums.list()), ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page') ?? 1);
    const pageSize = Number(url.searchParams.get('pageSize') ?? 20);
    return HttpResponse.json(
      paginate([buildAlbum(), buildAlbum(), buildAlbum()], page, pageSize),
    );
  }),
  http.get(
    endpoints.albums.detail(':id'),
    ({ params }) =>
      HttpResponse.json(buildAlbumDetail({ id: String(params.id) })),
  ),

  // --- Tracks (F2/F3) ---
  http.get(
    endpoints.tracks.detail(':id'),
    ({ params }) =>
      HttpResponse.json(buildTrack({ id: String(params.id) })),
  ),
  // Binary audio stream — the only non-JSON guarded endpoint. The blob path
  // (FE-PR1-10) consumes this through httpClient.getBlob → res.blob().
  http.get(
    endpoints.tracks.stream(':id'),
    () =>
      new HttpResponse(sampleMp3, {
        headers: { 'content-type': 'audio/mpeg' },
      }),
  ),

  // --- Search (F4) ---
  http.get(basePath(endpoints.search('seed')), () =>
    HttpResponse.json(buildSearchResult()),
  ),
];

/**
 * Coverage assertion input for FE-PR1-11 — the {method, path} of every
 * registered handler. MSW 2 HttpHandler exposes `.info.{method,path}`.
 */
export const registeredPaths: ReadonlyArray<{
  method: string;
  path: string;
}> = handlers.map((h) => ({
  method: String(h.info.method),
  path: String(h.info.path),
}));
