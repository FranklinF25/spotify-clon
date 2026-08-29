import '../../../infrastructure/openapi-shared';
import { errorJson, type ContextOpenApiRegistrar } from '../../../infrastructure/openapi-shared';

/**
 * OpenAPI registry for the playback bounded context (API-DOC — PB-PR2-06,
 * REQ-PLAY-005 + REQ-PLAY-007).
 *
 * Registers the single `PlaybackController` route. There is no request body
 * and no JSON success schema — the response is raw audio bytes whose
 * `Content-Type` derives from the resolved file extension (see
 * `FsAudioStorage.contentTypeForPath`: .mp3 → audio/mpeg, .flac →
 * audio/flac, .ogg/.opus → audio/ogg, .m4a → audio/mp4, .wav → audio/wav;
 * unknown → audio/mpeg fallback).
 *
 * The 416 body is intentionally empty (RFC 7233 §4.4 — the client reads the
 * unsatisfiable-range signal from the `Content-Range` response header, Q5),
 * so that response documents headers only, no content.
 */

/**
 * Shared header descriptors for the audio success responses.
 * `Content-Type` mirrors the extension-derived MIME map (not a fixed value).
 */
const audioResponseHeaders = {
  'Accept-Ranges': {
    description: 'Always `bytes` — the server honors Range requests',
    schema: { type: 'string' as const, enum: ['bytes'] },
  },
  'Content-Type': {
    description: 'Extension-derived audio MIME (audio/mpeg, audio/flac, audio/ogg, audio/mp4, audio/wav)',
    schema: { type: 'string' } as const,
  },
  'Content-Length': {
    description: 'Byte length of the returned body (full total, or `end - start + 1` for 206)',
    schema: { type: 'integer' } as const,
  },
};

/** Binary audio body shared by the 200/206 responses. */
const audioBinaryContent = {
  'audio/mpeg': { schema: { type: 'string', format: 'binary' } as const },
  'audio/flac': { schema: { type: 'string', format: 'binary' } as const },
  'audio/ogg': { schema: { type: 'string', format: 'binary' } as const },
  'audio/mp4': { schema: { type: 'string', format: 'binary' } as const },
  'audio/wav': { schema: { type: 'string', format: 'binary' } as const },
};

/** Registrar — see the module docstring and `src/infrastructure/openapi-document.ts`. */
export const registerPlaybackOpenApi: ContextOpenApiRegistrar = (registry) => {
  registry.registerPath({
    method: 'get',
    path: '/api/v1/tracks/{id}/stream',
    tags: ['playback'],
    summary: 'Stream a track (Range-aware)',
    description:
      'Streams the track bytes for playback. Without a `Range` header the full body returns ' +
      'with 200; a satisfiable single-range request returns 206 with the slice. Multi-range or ' +
      'malformed `Range` values are rejected 400; an unsatisfiable range (past EOF) returns 416 ' +
      'with an EMPTY body — the signal lives in `Content-Range: bytes */<total>` (RFC 7233 §4.4). ' +
      'A track row whose file is missing on disk is a 404 like any unknown id.',
    security: [{ bearerAuth: [] }],
    parameters: [
      {
        name: 'id',
        in: 'path',
        required: true,
        schema: { type: 'string' } as const,
        description: 'Track id (unknown ids — and missing files — resolve to 404)',
      },
      {
        name: 'Range',
        in: 'header',
        required: false,
        schema: { type: 'string' } as const,
        description: 'Byte range, e.g. `bytes=0-1023`. Single range only; multiple ranges are rejected 400.',
      },
    ],
    responses: {
      200: {
        description: 'Full audio body',
        headers: audioResponseHeaders,
        content: audioBinaryContent,
      },
      206: {
        description: 'Partial audio body (satisfiable single range)',
        headers: {
          ...audioResponseHeaders,
          'Content-Range': {
            description: '`bytes <start>-<end>/<total>` describing the returned slice',
            schema: { type: 'string' } as const,
          },
        },
        content: audioBinaryContent,
      },
      400: errorJson('Invalid Range header (malformed or multi-range; details on field "Range")'),
      401: errorJson('Missing or invalid access token'),
      404: errorJson('Unknown track id, or file missing on disk'),
      416: {
        description:
          'Unsatisfiable range — EMPTY body by design; read `Content-Range: bytes */<total>`',
        headers: {
          'Content-Range': {
            description: '`bytes */<total>` — the unsatisfied-range indicator',
            schema: { type: 'string' } as const,
          },
        },
      },
    },
  });
};
