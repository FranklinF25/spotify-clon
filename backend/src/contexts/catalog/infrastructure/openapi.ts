import { z } from 'zod';

import '../../../infrastructure/openapi-shared';
import { binaryFilePartSchema, errorJson, type ContextOpenApiRegistrar } from '../../../infrastructure/openapi-shared';
import { paginationSchema } from './dto/pagination.dto';
import { searchSchema } from './dto/search.dto';

/**
 * OpenAPI registry for the catalog bounded context (API-DOC — CAT-PR2b1,
 * CAT-PR3c, REQ-UPLOAD-001).
 *
 * Registers the seven `CatalogController` routes, REUSING the zod query
 * schemas the controller validates with (`dto/pagination.dto.ts`,
 * `dto/search.dto.ts`) so request contracts cannot drift from the document.
 *
 * Response shapes mirror the domain read-models
 * (`domain/read-models.ts`) and entity projections (`Artist/Album/Track
 * .toPrimitive()`) as zod — they are TS interfaces on the controller path,
 * so these mirrors are hand-synced the same way the frontend's
 * `src/types/api.ts` is. `filePath` is structurally absent everywhere (R4 —
 * internal storage detail, never leaks over HTTP).
 *
 * EXPORTED MIRRORS: `albumSummarySchema` / `trackPrimitiveSchema` are
 * imported by the library and playlists registries (their use cases embed
 * the catalog read-models cross-context — mirrors the domain-level import
 * direction library/playlists → catalog read-models, which the ESLint
 * boundary rules already permit infrastructure → infrastructure).
 */

/**
 * Zod mirror of `ArtistSummary` (`domain/read-models.ts`) — lean projection
 * used by list endpoints and nested embedding.
 */
export const artistSummarySchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
  })
  .openapi('Catalog.ArtistSummary');

/**
 * Zod mirror of `AlbumSummary` (`domain/read-models.ts`) — embeds the artist
 * so list rows render "Album — by Artist" without a second hop.
 * `releaseYear` / `coverUrl` are nullable columns.
 */
export const albumSummarySchema = z
  .object({
    id: z.string().uuid(),
    title: z.string(),
    releaseYear: z.number().int().nullable(),
    coverUrl: z.string().nullable(),
    artist: artistSummarySchema,
  })
  .openapi('Catalog.AlbumSummary');

/**
 * Zod mirror of `Track.toPrimitive()` (`domain/track.entity.ts`) — `filePath`
 * and `createdAt` are omitted by the projection itself (R4 guard).
 */
export const trackPrimitiveSchema = z
  .object({
    id: z.string().uuid(),
    title: z.string(),
    durationSeconds: z.number().int(),
    trackNumber: z.number().int(),
    albumId: z.string().uuid(),
  })
  .openapi('Catalog.TrackPrimitive');

/** Zod mirror of `TrackSummary` (`domain/read-models.ts`) — search hits carry `albumId` as a primitive (CO-catalog-5 asymmetry, do NOT "fix"). */
const trackSummarySchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  durationSeconds: z.number().int(),
  albumId: z.string().uuid(),
});

/**
 * Zod mirror of `PaginatedResult<T>` (`domain/read-models.ts`) — the generic
 * offset-pagination envelope shared by `GET /artists` + `GET /albums`.
 */
function paginatedOf(item: z.ZodTypeAny) {
  return z.object({
    items: z.array(item),
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
  });
}

/**
 * Zod mirror of the `GET /artists/:id` controller shape
 * (`{ ...artist.toPrimitive(), albums }`) — `ArtistDetail` is WIDER than
 * `ArtistSummary` (adds `bio` / `imageUrl` / embedded `albums`).
 */
const artistDetailResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  bio: z.string().nullable(),
  imageUrl: z.string().nullable(),
  albums: z.array(albumSummarySchema),
});

/**
 * Zod mirror of the `GET /albums/:id` controller shape
 * (`{ ...album.toPrimitive(), artist, tracks: tracks.map(toPrimitive) }`).
 */
const albumDetailResponseSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  releaseYear: z.number().int().nullable(),
  coverUrl: z.string().nullable(),
  artistId: z.string().uuid(),
  artist: artistSummarySchema,
  tracks: z.array(trackPrimitiveSchema),
});

/** Zod mirror of `SearchResult` (`domain/read-models.ts`) — all three arrays always present (empty when no matches, S4). */
const searchResultSchema = z.object({
  artists: z.array(artistSummarySchema),
  albums: z.array(albumSummarySchema),
  tracks: z.array(trackSummarySchema),
});

/**
 * Zod mirror of `UploadTrackResult` (`application/upload-track.use-case.ts`)
 * — the 201 body of `POST /tracks/upload`. Deterministic derived ids; NO
 * `filePath` anywhere in the payload.
 */
const uploadResultSchema = z.object({
  track: z.object({
    id: z.string().uuid(),
    title: z.string(),
    durationSeconds: z.number().int(),
    albumId: z.string().uuid(),
  }),
  artist: artistSummarySchema,
  album: z.object({ id: z.string().uuid(), title: z.string() }),
});

/** Catalog list/detail ids are NOT format-checked at the edge — unknown or malformed ids are uniformly 404 (mirrors controller behavior). */
const idParam = {
  name: 'id',
  in: 'path' as const,
  required: true,
  schema: { type: 'string' } as const,
  description: 'Catalog resource id (unknown ids resolve to 404)',
};

/** Registrar — see the module docstring and `src/infrastructure/openapi-document.ts`. */
export const registerCatalogOpenApi: ContextOpenApiRegistrar = (registry) => {
  registry.registerPath({
    method: 'get',
    path: '/api/v1/artists',
    tags: ['catalog'],
    summary: 'List artists (paginated)',
    description:
      'Offset-paginated artist summaries. Query validated by `paginationSchema` (zod); bounds ' +
      'enforced by `validatePaginationBounds` (page ∈ [1, 1_000_000], pageSize ∈ [1, 100], defaults 1/20).',
    security: [{ bearerAuth: [] }],
    request: { query: paginationSchema },
    responses: {
      200: {
        description: 'Paginated artist summaries',
        content: { 'application/json': { schema: paginatedOf(artistSummarySchema) } },
      },
      400: errorJson('Out-of-bounds page/pageSize (INVALID_PAGINATION)'),
      401: errorJson('Missing or invalid access token'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/artists/{id}',
    tags: ['catalog'],
    summary: 'Artist detail with albums',
    description: 'Full artist projection plus its album summaries (spec-locked embedding policy).',
    security: [{ bearerAuth: [] }],
    parameters: [idParam],
    responses: {
      200: {
        description: 'Artist detail',
        content: { 'application/json': { schema: artistDetailResponseSchema } },
      },
      404: errorJson('Unknown artist id'),
      401: errorJson('Missing or invalid access token'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/albums',
    tags: ['catalog'],
    summary: 'List albums (paginated)',
    description:
      'Offset-paginated album summaries with the owning artist embedded. Same pagination ' +
      'contract as `GET /artists` (shared `paginationSchema` + `validatePaginationBounds`).',
    security: [{ bearerAuth: [] }],
    request: { query: paginationSchema },
    responses: {
      200: {
        description: 'Paginated album summaries',
        content: { 'application/json': { schema: paginatedOf(albumSummarySchema) } },
      },
      400: errorJson('Out-of-bounds page/pageSize (INVALID_PAGINATION)'),
      401: errorJson('Missing or invalid access token'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/albums/{id}',
    tags: ['catalog'],
    summary: 'Album detail with tracks',
    description:
      'Album projection plus the artist summary and the ordered track list (trackNumber asc). ' +
      'Track entries are `TrackPrimitive`s — `filePath` is structurally absent (R4).',
    security: [{ bearerAuth: [] }],
    parameters: [idParam],
    responses: {
      200: {
        description: 'Album detail',
        content: { 'application/json': { schema: albumDetailResponseSchema } },
      },
      404: errorJson('Unknown album id'),
      401: errorJson('Missing or invalid access token'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/tracks/{id}',
    tags: ['catalog'],
    summary: 'Track detail',
    description:
      'Single track projection. The internal `filePath` is dropped by `Track.toPrimitive()` — ' +
      'clients stream via `GET /tracks/{id}/stream` (playback context) instead.',
    security: [{ bearerAuth: [] }],
    parameters: [idParam],
    responses: {
      200: {
        description: 'Track detail',
        content: { 'application/json': { schema: trackPrimitiveSchema } },
      },
      404: errorJson('Unknown track id'),
      401: errorJson('Missing or invalid access token'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/search',
    tags: ['catalog'],
    summary: 'Full-text catalog search',
    description:
      'Grouped tsvector search across artists, albums and tracks. `q` must be non-empty after ' +
      'trim (INVALID_QUERY otherwise); optional `type` narrows to one group. Results use ' +
      'summaries — never raw entities, never `filePath` (S4).',
    security: [{ bearerAuth: [] }],
    request: { query: searchSchema },
    responses: {
      200: {
        description: 'Grouped matches (arrays always present)',
        content: { 'application/json': { schema: searchResultSchema } },
      },
      400: errorJson('Empty or missing q (INVALID_QUERY)'),
      401: errorJson('Missing or invalid access token'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/tracks/upload',
    tags: ['catalog'],
    summary: 'Upload an audio file',
    description:
      'Multipart upload (field name `file`). Extension allowlist: .mp3, .flac, .ogg, .m4a, ' +
      '.wav, .opus (case-insensitive); size cap 150 MB (multer `limits.fileSize`, cut off ' +
      'mid-flight). Tags are parsed from the bytes (seeder-identical degradation to the ' +
      '`Artist - Title.ext` fallback) and rows are upserted with deterministic ids — a re-upload ' +
      'of the same filename converges on the same catalog rows (REQ-UPLOAD-001..003).',
    security: [{ bearerAuth: [] }],
    request: {
      body: {
        required: true,
        content: {
          'multipart/form-data': {
            schema: z.object({
              file: binaryFilePartSchema.describe('Audio file (.mp3/.flac/.ogg/.m4a/.wav/.opus, max 150 MB)'),
            }),
          },
        },
      },
    },
    responses: {
      201: {
        description: 'Track created-or-updated (upsert); derived artist/album echoed back',
        content: { 'application/json': { schema: uploadResultSchema } },
      },
      400: errorJson('No file part, unsupported extension, oversize, or path-y filename (VALIDATION_ERROR, details on field "file")'),
      401: errorJson('Missing or invalid access token'),
    },
  });
};
