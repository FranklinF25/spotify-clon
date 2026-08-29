import { z } from 'zod';

import '../../../infrastructure/openapi-shared';
import { errorJson, type ContextOpenApiRegistrar } from '../../../infrastructure/openapi-shared';
import { albumSummarySchema } from '../../catalog/infrastructure/openapi';

/**
 * OpenAPI registry for the library bounded context (API-DOC — F6, design
 * §8, REQ-L-001..007).
 *
 * Registers the three `LibraryController` routes. There is no request body
 * anywhere on this surface; the `:albumId` path param is the SAME uuid
 * contract `parseAlbumIdParam` enforces at the edge (`dto/album-id.param.ts`
 * — malformed uuid → 422, REQ-L-002 decision D6), so the parameter schema
 * mirrors `z.string().uuid()`.
 *
 * The list response mirrors `SavedAlbum` (`application/list-library.use-case.ts`)
 * — the catalog `AlbumSummary` projection is imported from the catalog
 * registry (single source; mirrors the domain-level read-model dependency
 * library → catalog). `addedAt` serializes as an ISO string via JSON.
 */
const savedAlbumSchema = z
  .object({
    album: albumSummarySchema,
    addedAt: z.string().datetime().describe('When the caller saved the album'),
  })
  .openapi('Library.SavedAlbum');

/** Registrar — see the module docstring and `src/infrastructure/openapi-document.ts`. */
export const registerLibraryOpenApi: ContextOpenApiRegistrar = (registry) => {
  registry.registerPath({
    method: 'get',
    path: '/api/v1/library/albums',
    tags: ['library'],
    summary: "List the caller's saved albums",
    description:
      'Bare `SavedAlbum[]` (design D5 — mirrors GET /playlists), recency-ordered regardless of ' +
      'hydration order (REQ-L-003). Unresolved catalog references are silently omitted (logged ' +
      'server-side — same posture as playlist track hydration).',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Saved albums, addedAt desc',
        content: { 'application/json': { schema: z.array(savedAlbumSchema) } },
      },
      401: errorJson('Missing or invalid access token'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/library/albums/{albumId}',
    tags: ['library'],
    summary: 'Save an album',
    description:
      'Upsert (re-saving an already-saved album keeps the ORIGINAL addedAt — recency is stable). ' +
      'A malformed uuid is 422 (decision D6); a well-formed but unknown albumId is also 422 ' +
      '(REQ-L-002 — "not a resolvable album reference"). No response body.',
    security: [{ bearerAuth: [] }],
    parameters: [
      {
        name: 'albumId',
        in: 'path',
        required: true,
        schema: { type: 'string', format: 'uuid' } as const,
        description: 'Album id (malformed OR unresolvable → 422)',
      },
    ],
    responses: {
      204: { description: 'Saved (idempotent upsert)' },
      422: errorJson('albumId is not a valid UUID, or matches no catalog album'),
      401: errorJson('Missing or invalid access token'),
    },
  });

  registry.registerPath({
    method: 'delete',
    path: '/api/v1/library/albums/{albumId}',
    tags: ['library'],
    summary: 'Remove a saved album',
    description:
      'Silent-idempotent 204 (REQ-L-004): removing an album that was never saved still returns ' +
      '204 — a malformed uuid is still 422 (the param guard is uniform on both handlers, D6).',
    security: [{ bearerAuth: [] }],
    parameters: [
      {
        name: 'albumId',
        in: 'path',
        required: true,
        schema: { type: 'string', format: 'uuid' } as const,
        description: 'Album id (malformed → 422; unknown → idempotent 204)',
      },
    ],
    responses: {
      204: { description: 'Removed (or was never saved — indistinguishable by design)' },
      422: errorJson('albumId is not a valid UUID'),
      401: errorJson('Missing or invalid access token'),
    },
  });
};
