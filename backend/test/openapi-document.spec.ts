import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Project, SyntaxKind } from 'ts-morph';
import { describe, expect, it } from 'vitest';

import { buildOpenApiDocument, type OpenApiDocument } from '../src/infrastructure/openapi-document';

/**
 * OpenAPI document-shape portfolio test (API-DOC).
 *
 * Asserts the structural contracts the Scalar reference depends on — the
 * things that are easy to silently break while editing a registry:
 *  - the JWT `bearerAuth` security scheme exists (Scalar's "try it" attaches
 *    `Authorization: Bearer …` through it);
 *  - every bounded context has exactly one tag (navigation grouping);
 *  - the multipart upload requestBody exists and types `file` as binary;
 *  - the error envelope exists as a REUSABLE component and its code enum
 *    mirrors the runtime `ErrorCode` union EXACTLY (ts-morph extracted —
 *    same zero-drift posture as the route-coverage guard);
 *  - the stream route declares its full status set (200/206/400/404/416);
 *  - document generation is built-once (memoized reference).
 */

const document: OpenApiDocument = buildOpenApiDocument();

const CONTEXT_TAGS = ['identity', 'catalog', 'playback', 'playlists', 'library', 'health'] as const;

/** ts-morph extraction of the `ErrorCode` union members from the runtime source of truth. */
function errorCodeUnionMembers(): string[] {
  const path = resolve(process.cwd(), 'src/shared/errors/domain-error.ts');
  if (!existsSync(path)) throw new Error('src/shared/errors/domain-error.ts not found');
  const source = readFileSync(path, 'utf8');
  const project = new Project({ useInMemoryFileSystem: false, skipFileResolution: true });
  const parsed = project.createSourceFile('domain-error.ts-extract.ts', source);
  const alias = parsed.getTypeAlias('ErrorCode');
  if (!alias) throw new Error('ErrorCode type alias not found in domain-error.ts');
  // Syntax-level extraction: the union's LiteralType nodes (quoted in source).
  const literals = alias.getDescendantsOfKind(SyntaxKind.LiteralType);
  if (literals.length === 0) throw new Error('ErrorCode union holds no literal members');
  return literals.map((literal) => literal.getText().replace(/^['"]|['"]$/g, '')).sort();
}

describe('openapi document shape (API-DOC)', () => {
  it('declares the JWT bearerAuth security scheme', () => {
    const schemes = (document.components?.securitySchemes ?? {}) as Record<
      string,
      { type: string; scheme?: string; bearerFormat?: string }
    >;
    expect(schemes.bearerAuth).toBeDefined();
    expect(schemes.bearerAuth.type).toBe('http');
    expect(schemes.bearerAuth.scheme).toBe('bearer');
    expect(schemes.bearerAuth.bearerFormat).toBe('JWT');
  });

  it('declares exactly one tag per bounded context (+ health)', () => {
    const tagNames = ((document.tags ?? []) as { name: string }[]).map((tag) => tag.name).sort();
    expect(tagNames).toEqual([...CONTEXT_TAGS].sort());
  });

  it('mounts against the nginx front door and describes the hexagonal contexts', () => {
    expect(document.servers).toEqual([
      expect.objectContaining({ url: 'https://localhost' }),
    ]);
    expect(document.info.title).toBe('Spotify Clon API');
    for (const context of ['identity', 'catalog', 'playback', 'playlists', 'library', 'hexagonal']) {
      expect(document.info.description.toLowerCase()).toContain(context);
    }
  });

  it('documents the multipart upload requestBody with a binary file part', () => {
    const upload = (document.paths as Record<string, Record<string, never>>)['/api/v1/tracks/upload']?.post as
      | { requestBody?: { content: Record<string, { schema: { properties?: Record<string, { format?: string }> } }> } }
      | undefined;
    expect(upload?.requestBody).toBeDefined();
    const part = upload!.requestBody!.content['multipart/form-data'];
    expect(part.schema.properties?.file, 'multipart schema must carry the "file" property').toBeDefined();
    expect(part.schema.properties!.file.format).toBe('binary');
  });

  it('reuses ONE ErrorEnvelope component referenced by 4xx responses', () => {
    const schemas = (document.components?.schemas ?? {}) as Record<string, unknown>;
    expect(schemas.ErrorEnvelope, 'ErrorEnvelope component must exist').toBeDefined();

    const refs = JSON.stringify(document).match(/"#\/components\/schemas\/ErrorEnvelope"/g) ?? [];
    expect(refs.length, 'many responses should $ref the envelope, not inline copies').toBeGreaterThan(20);
  });

  it('mirrors the runtime ErrorCode union exactly (ts-morph zero-drift)', () => {
    const schemas = (document.components?.schemas ?? {}) as Record<string, unknown>;
    // ErrorEnvelope.properties.error is a $ref to ErrorBody — read the enum there.
    const errorBody = (schemas.ErrorBody ?? {}) as {
      properties?: { code?: { enum?: string[] } };
    };
    const documented = [...(errorBody.properties?.code?.enum ?? [])].sort();
    expect(documented, 'ErrorBody.code.enum must exist').not.toEqual([]);
    expect(documented).toEqual(errorCodeUnionMembers());
  });

  it('declares the full stream status set with audio/* binary bodies', () => {
    const stream = (document.paths as Record<string, Record<string, never>>)['/api/v1/tracks/{id}/stream']?.get as
      | { responses: Record<string, { content?: Record<string, { schema?: { format?: string } }> }> }
      | undefined;
    expect(Object.keys(stream!.responses).sort()).toEqual(['200', '206', '400', '401', '404', '416']);
    for (const status of ['200', '206']) {
      const contentTypes = Object.keys(stream!.responses[status].content ?? {});
      expect(contentTypes.length).toBeGreaterThan(0);
      for (const contentType of contentTypes) {
        expect(contentType.startsWith('audio/')).toBe(true);
        expect(stream!.responses[status].content![contentType].schema?.format).toBe('binary');
      }
    }
    expect(stream!.responses['416'].content, '416 body is intentionally empty (RFC 7233 §4.4)').toBeUndefined();
  });

  it('guards protected routes with bearerAuth and leaves public routes open', () => {
    const paths = document.paths as Record<string, Record<string, { security?: unknown[] }>>;
    const guarded = (method: string, path: string) =>
      (paths[path]?.[method] as { security?: unknown[] } | undefined)?.security;

    expect(guarded('get', '/api/v1/me')).toEqual([{ bearerAuth: [] }]);
    expect(guarded('get', '/api/v1/playlists')).toEqual([{ bearerAuth: [] }]);
    expect(guarded('get', '/api/v1/tracks/{id}/stream')).toEqual([{ bearerAuth: [] }]);
    expect(guarded('post', '/api/v1/tracks/upload')).toEqual([{ bearerAuth: [] }]);

    // Public surface: health probe + the three token-issuing routes (refresh
    // + logout authenticate via the HttpOnly cookie, not a bearer header).
    expect(guarded('get', '/health')).toBeUndefined();
    expect(guarded('post', '/api/v1/auth/register')).toBeUndefined();
    expect(guarded('post', '/api/v1/auth/login')).toBeUndefined();
    expect(guarded('post', '/api/v1/auth/refresh')).toBeUndefined();
    expect(guarded('post', '/api/v1/auth/logout')).toBeUndefined();
  });

  it('builds the document once (memoized — never regenerated per request)', () => {
    expect(buildOpenApiDocument()).toBe(document);
  });
});
