import { OpenApiGeneratorV3, OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

import { registerCatalogOpenApi } from '../contexts/catalog/infrastructure/openapi';
import { registerIdentityOpenApi } from '../contexts/identity/infrastructure/openapi';
import { registerLibraryOpenApi } from '../contexts/library/infrastructure/openapi';
import { registerPlaybackOpenApi } from '../contexts/playback/infrastructure/openapi';
import { registerPlaylistsOpenApi } from '../contexts/playlists/infrastructure/openapi';
import './openapi-shared';

/**
 * OpenAPI document composition root (API-DOC).
 *
 * Builds the machine document served at `GET /api/v1/openapi.json` and fed
 * to the Scalar UI at `/api/v1/reference`. One registry, one pass over the
 * five bounded-context registrars + the public health probe, then
 * `OpenApiGeneratorV3` renders the final OpenAPI 3.0.3 object.
 *
 * Zero-drift architecture (the portfolio's signature move):
 *  - request contracts REUSE the zod DTO schemas the HTTP edge validates
 *    with — imported from `contexts/<ctx>/infrastructure/dto/`, never re-declared;
 *  - route coverage is ENFORCED by `test/openapi-coverage.spec.ts`, which
 *    scans the controllers' route decorators via ts-morph and asserts the
 *    document matches the real surface EXACTLY, both directions — adding a
 *    route without registering it (or registering a ghost route) fails CI;
 *  - the error-code enum is guarded against the `ErrorCode` union the same
 *    way (`test/openapi-document.spec.ts`).
 *
 * CACHING: `buildOpenApiDocument()` memoizes — the registry walk + generation
 * run ONCE per process (at boot in `main.ts`); the served object is the same
 * frozen-by-convention reference on every request. No per-request rebuild.
 *
 * This module deliberately contains NO NestJS imports: the document is pure
 * data, which is what lets the portfolio specs import and assert on it
 * without booting an application.
 */

/** Document type as produced by the v3 generator (avoids importing zod-to-openapi's transitive `openapi3-ts` under pnpm isolation). */
export type OpenApiDocument = ReturnType<OpenApiGeneratorV3['generateDocument']>;

/** Machine document mount path (raw express route in `main.ts` — Nest's global prefix does NOT apply to it). */
export const OPENAPI_JSON_PATH = '/api/v1/openapi.json';

/** Scalar UI mount path (`app.use` middleware in `main.ts` — likewise outside Nest routing). */
export const API_REFERENCE_PATH = '/api/v1/reference';

/** Zod mirror of the `GET /health` response (`HealthController` — fixed healthy payload). */
const healthResponseSchema = z.object({ status: z.literal('ok') });

/** Registrar list — one entry per bounded context; health is registered inline below (it lives at the app root, outside the contexts). */
const CONTEXT_REGISTRARS = [
  registerIdentityOpenApi,
  registerCatalogOpenApi,
  registerPlaybackOpenApi,
  registerPlaylistsOpenApi,
  registerLibraryOpenApi,
] as const;

/** Memoized document — built on first call, reused afterwards (see module docstring). */
let cachedDocument: OpenApiDocument | undefined;

/** Builds (once) the OpenAPI 3.0.3 document for the whole API surface. */
export function buildOpenApiDocument(): OpenApiDocument {
  cachedDocument ??= generate();
  return cachedDocument;
}

function generate(): OpenApiDocument {
  const registry = new OpenAPIRegistry();

  // JWT bearer scheme — what Scalar's "try it" uses to attach
  // `Authorization: Bearer <token>` on guarded operations.
  registry.registerComponent('securitySchemes', 'bearerAuth', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
    description:
      'Access token from POST /api/v1/auth/register|login|refresh. Refresh tokens never ' +
      'travel in headers — they live in the HttpOnly cookie managed by the identity context.',
  });

  // Health probe — mounted OUTSIDE the /api/v1 prefix by `main.ts`
  // (`setGlobalPrefix(..., { exclude: ['health'] })`) so load balancers can
  // probe without version coupling.
  registry.registerPath({
    method: 'get',
    path: '/health',
    tags: ['health'],
    summary: 'Liveness/readiness probe (public, unversioned)',
    description:
      'Fixed healthy payload. Deep dependency checks are intentionally out of scope; this ' +
      'route is exempt from the global /api/v1 prefix for load-balancer probes.',
    responses: {
      200: {
        description: 'Process is up',
        content: { 'application/json': { schema: healthResponseSchema } },
      },
    },
  });

  for (const register of CONTEXT_REGISTRARS) {
    register(registry);
  }

  return new OpenApiGeneratorV3(registry.definitions).generateDocument({
    openapi: '3.0.3',
    info: {
      title: 'Spotify Clon API',
      version: '1.0.0',
      description:
        'HTTP surface of the Spotify Clon backend — a NestJS 11 application built on a hexagonal ' +
        '(ports & adapters) architecture with five bounded contexts: identity (JWT auth + refresh ' +
        'rotation), catalog (artists/albums/tracks, search, uploads), playback (Range-aware audio ' +
        'streaming), playlists (owned CRUD + track ordering), and library (saved albums). ' +
        'This document is generated from the SAME zod schemas the edge validates requests with — ' +
        'no swagger decorators, no duplicated contracts. Errors use one envelope everywhere: ' +
        '`{ error: { code, message, details? } }`.',
    },
    servers: [
      {
        url: 'https://localhost',
        description: 'nginx TLS front door (proxies /api/ to this backend; /health passes through)',
      },
    ],
    tags: [
      { name: 'identity', description: 'Registration, login, refresh rotation, logout, current profile' },
      { name: 'catalog', description: 'Artist/album/track reads, full-text search, audio uploads' },
      { name: 'playback', description: 'Range-aware audio streaming' },
      { name: 'playlists', description: 'Owned playlists: CRUD + add/remove/reorder tracks' },
      { name: 'library', description: 'Saved albums (per-user)' },
      { name: 'health', description: 'Public liveness/readiness probe (unversioned)' },
    ],
  });
}
