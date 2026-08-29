import { z } from 'zod';

import '../../../infrastructure/openapi-shared';
import { errorJson, type ContextOpenApiRegistrar } from '../../../infrastructure/openapi-shared';
import { trackPrimitiveSchema } from '../../catalog/infrastructure/openapi';
import { addTrackSchema } from './dto/add-track.dto';
import { createPlaylistSchema } from './dto/create-playlist.dto';
import { reorderSchema } from './dto/reorder.dto';
import { renamePlaylistSchema } from './dto/rename-playlist.dto';

/**
 * OpenAPI registry for the playlists bounded context (API-DOC — F5, design
 * §11, REQ-P-001..011).
 *
 * Registers the nine `PlaylistsController` routes, REUSING the four zod DTO
 * schemas the controller parses bodies with (`dto/create-playlist.dto.ts`,
 * `dto/rename-playlist.dto.ts`, `dto/add-track.dto.ts`, `dto/reorder.dto.ts`)
 * — request contracts are imported, never re-declared.
 *
 * Response mirrors below follow the use-case return shapes:
 *  - CRUD handlers return `PlaylistPrimitive` (JSON-serialized: `Date` → ISO
 *    string, hence `.datetime()`),
 *  - add-track/reorder return `PlaylistTrackPrimitive[]` entries
 *    (`{ position, trackId, addedAt }` — `playlistId` omitted by the
 *    projection since callers already know the playlist),
 *  - `GET /:id/tracks` returns hydrated catalog `TrackPrimitive[]` — the
 *    mirror is IMPORTED from the catalog registry (single source, mirrors
 *    the domain-level read-model dependency playlists → catalog).
 *
 * Every route is JWT-guarded (class-level `@UseGuards(JwtAuthGuard)`,
 * REQ-P-001) so every operation declares the bearer scheme. Mutations on a
 * playlist you do not own are 403; reads (`GET /:id`, `GET /:id/tracks`) are
 * open reads (REQ-P-004 / REQ-P-008).
 */

/**
 * Zod mirror of `PlaylistPrimitive` (`domain/playlist.entity.ts`) — all five
 * fields public; `createdAt`/`updatedAt` serialize as ISO strings via JSON.
 */
export const playlistSchema = z
  .object({
    id: z.string().uuid(),
    userId: z.string().uuid().describe('Owner (the JWT `sub` the playlist was created with)'),
    title: z.string().describe('Trimmed to 1..100 chars (LOCKED product #5)'),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('Playlists.Playlist');

/**
 * Zod mirror of `PlaylistTrackPrimitive` (`domain/playlist-track.vo.ts`) —
 * the projection omits `playlistId`.
 */
export const playlistTrackSchema = z
  .object({
    position: z.number().int().positive().describe('1-based slot (compact-on-remove keeps it gapless)'),
    trackId: z.string().uuid(),
    addedAt: z.string().datetime(),
  })
  .openapi('Playlists.PlaylistTrack');

/** Playlist ids are not format-checked at the edge — unknown ids are uniformly 404 (mirrors controller behavior). */
const idParam = {
  name: 'id',
  in: 'path' as const,
  required: true,
  schema: { type: 'string' } as const,
  description: 'Playlist id (unknown ids resolve to 404)',
};

/** Registrar — see the module docstring and `src/infrastructure/openapi-document.ts`. */
export const registerPlaylistsOpenApi: ContextOpenApiRegistrar = (registry) => {
  registry.registerPath({
    method: 'post',
    path: '/api/v1/playlists',
    tags: ['playlists'],
    summary: 'Create a playlist',
    description:
      'Creates an empty playlist owned by the caller (`ownerId` comes from the JWT, never the body). ' +
      'Title trims to 1..100 chars (LOCKED product #5).',
    security: [{ bearerAuth: [] }],
    request: { body: { required: true, content: { 'application/json': { schema: createPlaylistSchema } } } },
    responses: {
      201: {
        description: 'Playlist created',
        content: { 'application/json': { schema: playlistSchema } },
      },
      400: errorJson('Title missing / empty after trim / over 100 chars / wrong type'),
      401: errorJson('Missing or invalid access token'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/playlists',
    tags: ['playlists'],
    summary: "List the caller's playlists",
    description: 'Bare array (design D5 — no envelope), newest first.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Own playlists, createdAt desc',
        content: { 'application/json': { schema: z.array(playlistSchema) } },
      },
      401: errorJson('Missing or invalid access token'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/playlists/{id}',
    tags: ['playlists'],
    summary: 'Playlist detail (open read)',
    description: 'Any authenticated caller may read any playlist (REQ-P-004 — no ownership check on reads).',
    security: [{ bearerAuth: [] }],
    parameters: [idParam],
    responses: {
      200: {
        description: 'Playlist detail',
        content: { 'application/json': { schema: playlistSchema } },
      },
      404: errorJson('Unknown playlist id'),
      401: errorJson('Missing or invalid access token'),
    },
  });

  registry.registerPath({
    method: 'patch',
    path: '/api/v1/playlists/{id}',
    tags: ['playlists'],
    summary: 'Rename a playlist',
    description:
      'Owner-only mutation: existence is checked first (404), then ownership (403) — REQ-P-011 ' +
      'ordering. Same 1..100 title invariant as create; `updatedAt` bumps.',
    security: [{ bearerAuth: [] }],
    parameters: [idParam],
    request: { body: { required: true, content: { 'application/json': { schema: renamePlaylistSchema } } } },
    responses: {
      200: {
        description: 'Renamed playlist',
        content: { 'application/json': { schema: playlistSchema } },
      },
      400: errorJson('Title missing / empty after trim / over 100 chars / wrong type'),
      403: errorJson('Playlist exists but is owned by another user'),
      404: errorJson('Unknown playlist id'),
      401: errorJson('Missing or invalid access token'),
    },
  });

  registry.registerPath({
    method: 'delete',
    path: '/api/v1/playlists/{id}',
    tags: ['playlists'],
    summary: 'Delete a playlist',
    description: 'Owner-only. Cascades the junction rows (FK CASCADE, REQ-P-006). No response body.',
    security: [{ bearerAuth: [] }],
    parameters: [idParam],
    responses: {
      204: { description: 'Deleted' },
      403: errorJson('Playlist exists but is owned by another user'),
      404: errorJson('Unknown playlist id'),
      401: errorJson('Missing or invalid access token'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/playlists/{id}/tracks',
    tags: ['playlists'],
    summary: 'Append a track',
    description:
      'Appends at `max(position)+1` (transactional). Repeatable tracks are legal — appending the ' +
      'same trackId twice lands on consecutive positions (LOCKED product #2). A well-formed but ' +
      'unknown `trackId` is 422 (LOCKED design R1: valid UUID, unresolvable reference), distinct ' +
      'from the 400 malformed-payload case.',
    security: [{ bearerAuth: [] }],
    parameters: [idParam],
    request: { body: { required: true, content: { 'application/json': { schema: addTrackSchema } } } },
    responses: {
      201: {
        description: 'Track appended (echoes the new slot)',
        content: { 'application/json': { schema: playlistTrackSchema } },
      },
      400: errorJson('trackId missing or not a UUID'),
      403: errorJson('Playlist exists but is owned by another user'),
      404: errorJson('Unknown playlist id'),
      422: errorJson('trackId is a valid UUID but matches no catalog track'),
      401: errorJson('Missing or invalid access token'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/playlists/{id}/tracks',
    tags: ['playlists'],
    summary: 'List playlist tracks, hydrated (open read)',
    description:
      'Ordered hydrated `TrackPrimitive[]` ready for playback. Unresolved catalog references ' +
      'are silently omitted (logged server-side — LOCKED product #3 + design R7).',
    security: [{ bearerAuth: [] }],
    parameters: [idParam],
    responses: {
      200: {
        description: 'Hydrated tracks in position order',
        content: { 'application/json': { schema: z.array(trackPrimitiveSchema) } },
      },
      404: errorJson('Unknown playlist id'),
      401: errorJson('Missing or invalid access token'),
    },
  });

  registry.registerPath({
    method: 'delete',
    path: '/api/v1/playlists/{id}/tracks/{position}',
    tags: ['playlists'],
    summary: 'Remove the track at a position',
    description:
      'Delete-then-compact inside one transaction (REQ-P-009). A non-existent position is 404 — ' +
      'including non-integer / non-positive segments, which can never reference a row.',
    security: [{ bearerAuth: [] }],
    parameters: [
      idParam,
      {
        name: 'position',
        in: 'path',
        required: true,
        schema: { type: 'integer', minimum: 1 } as const,
        description: '1-based slot (out-of-range integers resolve to 404)',
      },
    ],
    responses: {
      204: { description: 'Removed; trailing positions compacted' },
      403: errorJson('Playlist exists but is owned by another user'),
      404: errorJson('Unknown playlist id, or position out of range'),
      401: errorJson('Missing or invalid access token'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/playlists/{id}/reorder',
    tags: ['playlists'],
    summary: 'Move a track to a new position',
    description:
      'Single-statement insert-and-shift (REQ-P-010). Success is 200 (rewrites an existing ' +
      'resource — pinned, NOT NestJS\'s 201 default). Out-of-range or non-integer positions are ' +
      '422 (position-shape errors are 422, not 400). `from === to` short-circuits idempotently ' +
      'and still returns the current ordering.',
    security: [{ bearerAuth: [] }],
    parameters: [idParam],
    request: { body: { required: true, content: { 'application/json': { schema: reorderSchema } } } },
    responses: {
      200: {
        description: 'Full post-reorder ordering (uniform response shape, also on no-op)',
        content: { 'application/json': { schema: z.array(playlistTrackSchema) } },
      },
      403: errorJson('Playlist exists but is owned by another user'),
      404: errorJson('Unknown playlist id'),
      422: errorJson('from/to non-integer, non-positive, or beyond the last position'),
      401: errorJson('Missing or invalid access token'),
    },
  });
};
