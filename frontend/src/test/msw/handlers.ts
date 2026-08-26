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
  buildUploadResult,
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
 * API base — mirrors `endpoints.ts` BASE. Declared here (not imported from
 * endpoints) because the MSW `:id` param patterns below must NOT be passed
 * through `endpoints.*.detail(':id')` — that route runs `encodeURIComponent`
 * on the id, mangling `:id` into `%3Aid` and breaking the match. Real UUIDs
 * are URL-safe so the encoding in `endpoints` is correct for production; only
 * the MSW pattern literal needs the raw `:id` token.
 */
const API = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';

/**
 * MSW handlers for every slice-A endpoint (REQ-FE-005 "Every slice-A
 * endpoint has an MSW handler") + the F7 upload route. `:id` path params are
 * echoed into the response so path-id matching is deterministic regardless
 * of the fake sequence counter.
 *
 * `/auth/refresh` returns `{ accessToken }` ONLY (no `user`) — matching
 * AuthController.refresh (DESIGN §4.1). The boot flow hydrates `user` via
 * the separate `/me` handler.
 *
 * The upload handler answers the 201 contract (UploadTrackResult) for BOTH
 * transports: MSW's node interceptors catch jsdom XMLHttpRequest too (the
 * uploadFile helper sends via XHR for progress) — verified in the F7 specs,
 * which drive the page end-to-end through this handler.
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
    `${API}/artists/:id`,
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
    `${API}/albums/:id`,
    ({ params }) =>
      HttpResponse.json(buildAlbumDetail({ id: String(params.id) })),
  ),

  // --- Tracks (F2/F3) ---
  http.get(
    `${API}/tracks/:id`,
    ({ params }) =>
      HttpResponse.json(buildTrack({ id: String(params.id) })),
  ),
  // Binary audio stream — the only non-JSON guarded endpoint. The blob path
  // (FE-PR1-10) consumes this through httpClient.getBlob → res.blob().
  http.get(
    `${API}/tracks/:id/stream`,
    () =>
      new HttpResponse(sampleMp3, {
        headers: { 'content-type': 'audio/mpeg' },
      }),
  ),

  // --- Search (F4) ---
  http.get(basePath(endpoints.search('seed')), () =>
    HttpResponse.json(buildSearchResult()),
  ),

  // --- Upload (F7; REQ-UPLOAD-001) ---
  // Accepts any multipart body — the 400 VALIDATION_ERROR envelope cases are
  // per-spec `server.use` overrides; this default is the 201 happy path.
  http.post(
    endpoints.tracks.upload,
    () => HttpResponse.json(buildUploadResult(), { status: 201 }),
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
