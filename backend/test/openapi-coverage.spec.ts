import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Project, type Decorator, type StringLiteral } from 'ts-morph';
import { beforeAll, describe, expect, it } from 'vitest';

import { buildOpenApiDocument } from '../src/infrastructure/openapi-document';

/**
 * OpenAPI route-coverage portfolio test (API-DOC — the zero-drift guard).
 *
 * Mirrors the ts-morph scanning style of `test/architecture.spec.ts`: the
 * REAL route surface is derived from the controllers' decorators, not from
 * any hand-maintained list. Concretely:
 *  1. scan `src/contexts/<ctx>/infrastructure/*.controller.ts` (the five bounded
 *     contexts) plus the root `src/health.controller.ts` for
 *     `@Controller(prefix?)` + `@Get/@Post/@Put/@Patch/@Delete(path?)`
 *     decorators, building the concrete method+path set;
 *  2. normalize controller paths to their documented form — `/api/v1`
 *     prefix from `setGlobalPrefix` (health exempt), `:param` → `{param}`;
 *  3. generate the document via `buildOpenApiDocument()` (the same object
 *     `main.ts` serves) and collect its method+path entries;
 *  4. assert BOTH directions — every real route is documented AND every
 *     documented route is real.
 *
 * This makes the per-context registries (`contexts/<ctx>/infrastructure/openapi.ts`)
 * drift-proof: adding a controller route without registering it, deleting a
 * route that is still registered, or fat-fingering a path all fail here.
 */

const srcRoot = resolve(process.cwd(), 'src');
const HTTP_METHOD_DECORATORS = new Set(['Get', 'Post', 'Put', 'Patch', 'Delete']);

function posix(p: string): string {
  return p.split('\\').join('/');
}

/** Controller files = direct children of every context's infrastructure/ + the root health controller. */
function controllerFiles(): string[] {
  const contextsDir = resolve(srcRoot, 'contexts');
  const files: string[] = [resolve(srcRoot, 'health.controller.ts')];
  if (!existsSync(contextsDir)) return files;
  for (const context of readdirSync(contextsDir, { withFileTypes: true })) {
    if (!context.isDirectory()) continue;
    const infrastructure = resolve(contextsDir, context.name, 'infrastructure');
    if (!existsSync(infrastructure)) continue;
    for (const entry of readdirSync(infrastructure) as string[]) {
      if (entry.endsWith('.controller.ts')) files.push(resolve(infrastructure, entry));
    }
  }
  return files;
}

/** First string-literal argument of a decorator call, `''` when absent (`@Get()`). */
function decoratorPathArgument(decorator: Decorator): string {
  const arg = decorator.getArguments()[0] as StringLiteral | undefined;
  return arg?.getLiteralText() ?? '';
}

/**
 * `Controller('health')` + `@Get()` → `'/health'`;
 * bare `@Controller()` + `@Post('auth/register')` → `'/api/v1/auth/register'`;
 * `:id` path segments → `{id}` (OpenAPI templating).
 */
function toDocumentPath(controllerPrefix: string, routePath: string): string {
  const joined = [controllerPrefix, routePath]
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.replace(/^\/+/, '').replace(/\/+$/, ''))
    .join('/');
  const openApiPath = joined.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
  // Health is excluded from the global prefix in `main.ts`; every context
  // controller lives under it.
  return openApiPath === 'health' ? '/health' : `/api/v1/${openApiPath}`;
}

/** The REAL surface, straight from the controllers' decorators. */
function scanControllerRoutes(): Map<string, string> {
  const project = new Project({ useInMemoryFileSystem: false, skipFileResolution: true });
  const routes = new Map<string, string>();

  for (const file of controllerFiles()) {
    const source = project.getSourceFile(file) ?? project.addSourceFileAtPath(file);
    for (const cls of source.getClasses()) {
      const controllerDecorator = cls
        .getDecorators()
        .find((decorator) => decorator.getName() === 'Controller');
      if (!controllerDecorator) continue;

      const controllerPrefix = decoratorPathArgument(controllerDecorator);

      for (const method of cls.getMethods()) {
        for (const decorator of method.getDecorators()) {
          const name = decorator.getName();
          if (!HTTP_METHOD_DECORATORS.has(name)) continue;
          const httpMethod = name.toLowerCase();
          const routePath = decoratorPathArgument(decorator);
          const documentPath = toDocumentPath(controllerPrefix, routePath);
          const entry = `${httpMethod.toUpperCase()} ${documentPath}`;
          if (routes.has(entry)) {
            throw new Error(`duplicate route declaration scanned: ${entry} (${posix(file)})`);
          }
          routes.set(entry, posix(file));
        }
      }
    }
  }
  return routes;
}

/** The DOCUMENTED surface, straight from the generated document. */
function scanDocumentRoutes(): Map<string, string> {
  const document = buildOpenApiDocument();
  const routes = new Map<string, string>();
  for (const [path, pathItem] of Object.entries(document.paths)) {
    for (const method of Object.keys(pathItem)) {
      routes.set(`${method.toUpperCase()} ${path}`, path);
    }
  }
  return routes;
}

describe('openapi route coverage (API-DOC zero-drift guard)', () => {
  const controllerRoutes = scanControllerRoutes();
  const documentRoutes = scanDocumentRoutes();

  beforeAll(() => {
    // Sanity: the scan found the six controllers / 26 routes of the current
    // surface. When this fails after adding a controller, the counts below
    // tell you which side of the exact-match assertion moved.
    expect(controllerRoutes.size, 'controller scan found no routes — fix the scanner').toBeGreaterThan(0);
  });

  it('documents every controller route (no undocumented surface)', () => {
    const missing = [...controllerRoutes.keys()].filter((route) => !documentRoutes.has(route));
    expect(
      missing,
      `routes declared in controllers but absent from the openapi document (register them in the owning context's infrastructure/openapi.ts):\n${missing.join('\n')}`,
    ).toEqual([]);
  });

  it('documents no ghost routes (no route without a controller)', () => {
    const ghosts = [...documentRoutes.keys()].filter((route) => !controllerRoutes.has(route));
    expect(
      ghosts,
      `documented routes with no backing controller decorator (remove them from the registries):\n${ghosts.join('\n')}`,
    ).toEqual([]);
  });

  it('covers the full surface exactly (method+path sets are identical both directions)', () => {
    expect([...documentRoutes.keys()].sort()).toEqual([...controllerRoutes.keys()].sort());
  });

  it('covers the expected surface size (5 contexts + health)', () => {
    // identity 5 + catalog 7 + playback 1 + playlists 9 + library 3 + health 1.
    // Bump this ONLY when a route is intentionally added/removed on both sides.
    expect(controllerRoutes.size).toBe(26);
  });
});
