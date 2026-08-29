import { extendZodWithOpenApi, type OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

/**
 * Shared OpenAPI vocabulary for the Scalar reference (API-DOC).
 *
 * SIDE EFFECT FIRST: `extendZodWithOpenApi(z)` patches the shared zod
 * prototype with the `.openapi()` method that `@asteasolutions/zod-to-openapi`
 * v7 needs to attach component names / schema overrides. It MUST execute
 * before any module below builds a schema that calls `.openapi(...)` — which
 * is why every consumer imports THIS module before touching zod-to-openapi.
 * The extension only ADDS builder metadata; it never changes validation
 * behavior, so the pure-zod DTO files stay untouched and framework-free.
 *
 * Why this file exists (and why it is NOT `@nestjs/swagger`): the HTTP edge
 * already validates every request with plain zod schemas (see
 * `contexts/<ctx>/infrastructure/dto/`). Decorating controllers/DTOs a second
 * time would duplicate those contracts and introduce drift — the exact thing
 * this repo's zero-drift culture (executable contract tests, hand-synced
 * frontend mirrors) exists to prevent. Instead, the zod schemas are REUSED as
 * the single source of truth and rendered into an OpenAPI 3.0.3 document by
 * `src/infrastructure/openapi-document.ts`.
 *
 * Lives in `src/infrastructure/` (shared shell, outside the bounded
 * contexts — mirrors `config.tokens.ts` / `logger.ts` placement) so context
 * registries can import it without a shared↔context boundary violation.
 */

// Patch before any `.openapi()` call below (and in every importer).
extendZodWithOpenApi(z);

/**
 * Stable error-code vocabulary rendered into the document.
 *
 * Hand-synced with the `ErrorCode` union in `src/shared/errors/domain-error.ts`
 * (DESIGN §4.3). The sync is GUARDED by `test/openapi-document.spec.ts`,
 * which extracts the union members via ts-morph and compares them with this
 * enum — adding a code to `DomainError` without documenting it fails the
 * portfolio suite (same posture as the route-coverage guard).
 */
const ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'INTERNAL_ERROR',
  'INVALID_PAGINATION',
  'INVALID_QUERY',
  'UNPROCESSABLE_ENTITY',
] as const satisfies readonly (import('../shared/errors/domain-error').ErrorCode)[];

/**
 * Zod mirror of `ErrorDetail` (`shared/errors/domain-error.ts`) — the
 * field-scoped entry attached to validation failures.
 */
export const errorDetailSchema = z
  .object({
    field: z.string().describe('Dotted path of the offending field (`(root)` for body-level)'),
    issue: z.string().describe('Stable machine-readable token (zod issue code)'),
  })
  .openapi('ErrorDetail');

/**
 * Zod mirror of `DomainError.toJSON()` — the inner envelope body.
 *
 * `details` is only attached by `toJSON()` when non-empty (see
 * `domain-error.ts`), hence `.optional()` here.
 */
export const errorBodySchema = z
  .object({
    code: z.enum(ERROR_CODES).describe('Stable machine-readable error code'),
    message: z.string().describe('Human-readable summary (never leaks internals on 5xx)'),
    details: z.array(errorDetailSchema).optional().describe('Field-level feedback, validation errors only'),
  })
  .openapi('ErrorBody');

/**
 * Zod mirror of the DESIGN §4.3 envelope every error is normalized into by
 * `GlobalExceptionFilter` — `{ error: { code, message, details? } }`.
 *
 * Registered as the reusable `#/components/schemas/ErrorEnvelope` component
 * (via the `.openapi('ErrorEnvelope')` tag) so every 4xx/5xx response in the
 * document references ONE schema instead of inlining thirty copies.
 */
export const errorEnvelopeSchema = z
  .object({ error: errorBodySchema })
  .openapi('ErrorEnvelope');

/**
 * Builds a JSON error response entry referencing the shared
 * `ErrorEnvelope` component — the doc-side twin of what
 * `GlobalExceptionFilter.catch()` emits at runtime.
 *
 * Usage inside a registrar:
 *   responses: { 404: errorJson('Unknown playlist') }
 */
export function errorJson(description: string): {
  description: string;
  content: { 'application/json': { schema: typeof errorEnvelopeSchema } };
} {
  return {
    description,
    content: { 'application/json': { schema: errorEnvelopeSchema } },
  };
}

/**
 * Multipart file part for `POST /tracks/upload` (REQ-UPLOAD-001).
 *
 * `z.instanceof(File)` alone renders as an empty schema under zod-to-openapi
 * v7 (there is no File special-case); the explicit `.openapi()` override
 * swaps in the canonical OpenAPI binary part — `{ type: 'string', format:
 * 'binary' }` — which is what Scalar's "try it" file picker binds to.
 */
export const binaryFilePartSchema = z
  .instanceof(File)
  .openapi({ type: 'string', format: 'binary' });

/**
 * Registrar signature every bounded context exposes (`contexts/<ctx>/
 * infrastructure/openapi.ts`). Each registrar receives the SHARED registry
 * instance so the generated document is assembled from one definition set —
 * registries themselves stay context-local and framework-agnostic apart from
 * zod-to-openapi types.
 */
export type ContextOpenApiRegistrar = (registry: OpenAPIRegistry) => void;
