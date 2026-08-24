import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';

/**
 * Architecture portfolio test (DESIGN section 3.4) — evergreen guard.
 *
 * Reinforces the ESLint boundary rules with runtime assertions that per-file
 * lint rules cannot express cleanly:
 *  - every domain file imports ONLY relative paths (no framework packages);
 *  - every "Port" symbol is a TypeScript interface living under domain;
 *  - every "UseCase" class exposes exactly one public method, named "execute";
 *  - no Controller declaration exists outside context infrastructure folders.
 *
 * It MUST stay green against the current empty identity tree and grow as
 * identity lands — violations from PR-2 and PR-3 will fail this suite.
 *
 * Catalog PR-1 extensions (per DESIGN §Architecture portfolio test extension):
 *  - test-db.ts applyMigration iterates every migration folder;
 *  - test-db.ts truncate covers catalog tables (tracks / albums / artists);
 * Catalog port / reconstruct / read-models / shared-pagination framework-free
 * assertions land in PR-2a (CAT-PR2a-13) per R2-CRIT-3.
 */
const srcRoot = resolve(process.cwd(), 'src');

function posix(p: string): string {
  return p.split('\\').join('/');
}

/** parts = ['contexts', <ctx>, <layer>, ...rest] for context files. */
function contextLayer(rel: string): string | undefined {
  const parts = rel.split('/');
  if (parts[0] !== 'contexts') return undefined;
  return parts[2];
}

function isTypeScript(rel: string): boolean {
  return rel.endsWith('.ts') && !rel.endsWith('.d.ts');
}

/**
 * Production source = non-declaration TypeScript that is NOT a test file.
 * Test files (unit / integration / e2e specs) legitimately import vitest and
 * other dev-only packages, so the framework-import and structural scans below
 * must scope to production sources only.
 */
function isProduction(rel: string): boolean {
  return (
    isTypeScript(rel) &&
    !rel.endsWith('.spec.ts') &&
    !rel.endsWith('.integration-spec.ts') &&
    !rel.endsWith('.e2e-spec.ts')
  );
}

function sourceEntries(): string[] {
  if (!existsSync(srcRoot)) return [];
  return (readdirSync(srcRoot, { recursive: true }) as string[])
    .map((entry) => posix(entry))
    .filter((entry) => isProduction(entry));
}

const entries = sourceEntries();
const domainFiles = entries
  .filter((rel) => contextLayer(rel) === 'domain')
  .map((rel) => resolve(srcRoot, rel));
const applicationFiles = entries
  .filter((rel) => contextLayer(rel) === 'application')
  .map((rel) => resolve(srcRoot, rel));
const contextFiles = entries
  .filter((rel) => rel.split('/')[0] === 'contexts')
  .map((rel) => resolve(srcRoot, rel));

const project = new Project({ useInMemoryFileSystemSystem: false, skipFileResolution: true });

function loadSourceFile(absolutePath: string) {
  return project.getSourceFile(absolutePath) ?? project.addSourceFileAtPath(absolutePath);
}

function relOf(absolutePath: string): string {
  return posix(relative(srcRoot, absolutePath));
}

describe('architecture portfolio (DESIGN 3.4)', () => {
  it('exposes all five bounded contexts and the shared kernel', () => {
    for (const ctx of ['identity', 'catalog', 'playback', 'playlists', 'library']) {
      expect(existsSync(resolve(srcRoot, 'contexts', ctx))).toBe(true);
    }
    expect(existsSync(resolve(srcRoot, 'shared'))).toBe(true);
  });

  it('keeps the domain layer free of any non-relative RUNTIME (framework) import', () => {
    // REQ-BF-008 + CRIT-2 — type-only imports (`import type`) are erased at
    // compile time and therefore do NOT contaminate the domain at runtime.
    // The architecture test filters them out via ts-morph's
    // `importClause.isTypeOnly()`. This is what permits playback's
    // `AudioStream = Readable` alias (`import type { Readable } from
    // 'node:stream'`) while still banning runtime framework imports.
    const violations: string[] = [];
    for (const file of domainFiles) {
      const source = loadSourceFile(file);
      for (const declaration of source.getImportDeclarations()) {
        const specifier = declaration.getModuleSpecifierValue();
        if (!specifier.startsWith('.')) {
          const importClause = declaration.getImportClause();
          const isTypeOnly = importClause?.isTypeOnly() ?? false;
          if (isTypeOnly) continue; // allowed: erased at compile time
          violations.push(relOf(file) + ' imports "' + specifier + '"');
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('requires every Port symbol to be a TypeScript interface in domain', () => {
    const offenders: string[] = [];
    for (const file of domainFiles) {
      const source = loadSourceFile(file);
      for (const cls of source.getClasses()) {
        const name = cls.getName();
        if (name && name.endsWith('Port')) {
          offenders.push(relOf(file) + ': class ' + name + ' (expected interface)');
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('requires every UseCase class to expose exactly one public method: execute', () => {
    const offenders: string[] = [];
    for (const file of applicationFiles) {
      const source = loadSourceFile(file);
      for (const cls of source.getClasses()) {
        const name = cls.getName();
        if (!name || !name.endsWith('UseCase')) continue;

        const publicMethods = cls
          .getMethods()
          .filter((method) => method.getScope() !== 'private' && method.getScope() !== 'protected')
          .map((method) => method.getName());
        const executeCount = publicMethods.filter((method) => method === 'execute').length;
        const extras = publicMethods.filter((method) => method !== 'execute');

        if (executeCount !== 1) {
          offenders.push(relOf(file) + ': ' + name + ' has ' + executeCount + ' execute (expected 1)');
        }
        if (extras.length > 0) {
          offenders.push(relOf(file) + ': ' + name + ' exposes extra public methods: ' + extras.join(', '));
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('forbids Controller declarations outside context infrastructure', () => {
    const offenders: string[] = [];
    for (const file of contextFiles) {
      if (contextLayer(relOf(file)) === 'infrastructure') continue;
      const source = loadSourceFile(file);
      for (const cls of source.getClasses()) {
        const hasController = cls.getDecorators().some((decorator) => decorator.getName() === 'Controller');
        if (hasController) {
          offenders.push(relOf(file) + ': Controller outside infrastructure');
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('forbids application → infrastructure imports (DESIGN §3.4 rule 2)', () => {
    const offenders: string[] = [];
    for (const file of applicationFiles) {
      const source = loadSourceFile(file);
      for (const declaration of source.getImportDeclarations()) {
        const specifier = declaration.getModuleSpecifierValue();
        // Only relative specifiers can resolve to a context layer. External
        // packages (e.g. `zod`, `@nestjs/common`) are out of scope here —
        // they are governed by the domain-framework rule and the boundaries
        // ESLint plugin.
        if (!specifier.startsWith('.')) continue;
        const resolved = resolve(dirname(file), specifier);
        const rel = posix(relative(srcRoot, resolved));
        if (rel.split('/').includes('infrastructure')) {
          offenders.push(relOf(file) + ' imports "' + specifier + '" (crosses into infrastructure)');
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('declares the expected Driven Ports as interfaces under domain/ports', () => {
    const expected = [
      {
        name: 'UserRepositoryPort',
        path: 'contexts/identity/domain/ports/user-repository.port.ts',
      },
      {
        name: 'RefreshTokenRepositoryPort',
        path: 'contexts/identity/domain/ports/refresh-token-repository.port.ts',
      },
      {
        name: 'PasswordHasherPort',
        path: 'contexts/identity/domain/ports/password-hasher.port.ts',
      },
      {
        name: 'JwtSignerPort',
        path: 'contexts/identity/domain/ports/jwt-signer.port.ts',
      },
      {
        name: 'CatalogRepositoryPort',
        path: 'contexts/catalog/domain/ports/catalog-repository.port.ts',
      },
      // Playback driven ports (PB-PR1-04 + PB-PR1-05). Catalog's port is
      // re-exported via `playback/domain/ports/catalog-repo.port.ts` shim —
      // it stays declared in catalog's tree, so it is NOT re-listed here.
      {
        name: 'AudioStoragePort',
        path: 'contexts/playback/domain/ports/audio-storage.port.ts',
      },
      {
        name: 'RangeParserPort',
        path: 'contexts/playback/domain/ports/range-parser.port.ts',
      },
      // Library driven port (F6 — design §11.3 item 1). No entity exists
      // (design D1 — the join row IS the model), so this port-shape
      // assertion is the structural contract for the whole domain layer.
      {
        name: 'LibraryRepositoryPort',
        path: 'contexts/library/domain/ports/library-repository.port.ts',
      },
    ] as const;

    for (const { name, path } of expected) {
      const absolute = resolve(srcRoot, path);
      expect(existsSync(absolute), `expected port file ${path}`).toBe(true);
      const source = loadSourceFile(absolute);
      const interfaceNames = source.getInterfaces().map((i) => i.getName());
      expect(interfaceNames, `${name} must be declared as an interface in ${path}`).toContain(name);
      // The port MUST be an interface — a class would silently bypass the
      // "every Port is a TS interface" rule and let the application layer
      // depend on a concrete type.
      const classesNamedPort = source
        .getClasses()
        .map((c) => c.getName())
        .filter((n): n is string => Boolean(n) && n === name);
      expect(classesNamedPort, `${name} must not be a class`).toEqual([]);
    }
  });

  // ---------------------------------------------------------------------------
  // Playback PR-1 extensions (PB-PR1-14) — assert the playback domain types
  // are exported at their canonical path. These four types are the contract
  // the use case (PB-PR1-12), the controller (PR-2), and the ESLint rule
  // (PB-PR1-13) all depend on. Locked once and verified here so a future
  // refactor cannot silently rename them out from under callers.
  // ---------------------------------------------------------------------------

  it('exports the four playback domain types from contexts/playback/domain/types.ts', () => {
    const typesPath = 'contexts/playback/domain/types.ts';
    const absolute = resolve(srcRoot, typesPath);
    expect(existsSync(absolute), `expected types file ${typesPath}`).toBe(true);

    const source = loadSourceFile(absolute);
    const exported = source.getExportedDeclarations();
    const names = new Set<string>();
    for (const declarations of exported.values()) {
      for (const d of declarations) {
        const name = d.getSymbolOrThrow().getName();
        names.add(name);
      }
    }

    const expected = ['AudioStream', 'StreamResult', 'RangeResult', 'RangeParseResult'];
    for (const name of expected) {
      expect(
        names.has(name),
        `${name} must be exported from ${typesPath} (got: ${[...names].sort().join(', ')})`,
      ).toBe(true);
    }
  });

  // ---------------------------------------------------------------------------
  // Catalog PR-1 extensions (DESIGN §Architecture portfolio test extension).
  // These two assertions verify the test-harness refactor (CAT-PR1-08) so
  // future contexts inherit a working applyMigration + truncate. The catalog
  // port / reconstruct / read-models / shared-pagination framework-free
  // assertions land in PR-2a (CAT-PR2a-13) per R2-CRIT-3 — DO NOT add them
  // here in PR-1.
  // ---------------------------------------------------------------------------

  it('test-db applyMigration reads every prisma/migrations folder in lexicographic order (CAT-PR1-08)', () => {
    const testDbPath = resolve(process.cwd(), 'test/helpers/test-db.ts');
    expect(existsSync(testDbPath), 'test/helpers/test-db.ts must exist').toBe(true);
    const source = readFileSync(testDbPath, 'utf8');

    // readdirSync + sort — the iterate-all refactor (CAT-PR1-08). The old
    // single-folder implementation hard-coded `0000_init` instead.
    expect(source, 'applyMigration must call readdirSync on the migrations root').toContain(
      'readdirSync',
    );
    expect(source, 'applyMigration must sort folders so 0000_init runs before 0001_catalog').toContain(
      '.sort()',
    );
    // No remaining hard-coded `0000_init` path — the refactor must iterate.
    expect(
      source,
      'applyMigration must not hard-code the 0000_init path (single-folder legacy)',
    ).not.toContain("'prisma/migrations/0000_init/migration.sql'");
  });

  it('test-db truncate covers catalog tables (tracks, albums, artists) plus identity tables (CAT-PR1-08)', () => {
    const testDbPath = resolve(process.cwd(), 'test/helpers/test-db.ts');
    expect(existsSync(testDbPath), 'test/helpers/test-db.ts must exist').toBe(true);
    const source = readFileSync(testDbPath, 'utf8');

    // Every catalog + identity table must be in the TRUNCATE statement.
    // Order matters: catalog tables are truncated first so the FK CASCADE has
    // nothing to descend into (defensive — the explicit CASCADE would handle
    // it either way).
    const requiredTables = ['"tracks"', '"albums"', '"artists"', '"refresh_tokens"', '"users"'];
    for (const table of requiredTables) {
      expect(
        source,
        `truncate must include ${table} so tests start from a clean slate`,
      ).toContain(table);
    }
    expect(source, 'truncate must use RESTART IDENTITY CASCADE').toContain('RESTART IDENTITY CASCADE');
  });

  // ---------------------------------------------------------------------------
  // Playlists PR-1 extensions (F5 — design §14.5).
  // These three portfolio assertions land here — they guard the playlists
  // domain artefacts (entity methods + driven port shape) and the test-harness
  // truncate coverage that the new junction + owner tables require. The two
  // entity/port assertions are RED until WORK-PR1-04 lands the artefacts; the
  // truncate assertion is GREEN as soon as test-db.ts is edited (this unit).
  // ---------------------------------------------------------------------------

  it('test-db truncate covers playlists junction + owner tables (F5 — design §14.5)', () => {
    const testDbPath = resolve(process.cwd(), 'test/helpers/test-db.ts');
    expect(existsSync(testDbPath), 'test/helpers/test-db.ts must exist').toBe(true);
    const source = readFileSync(testDbPath, 'utf8');

    // playlist_tracks (junction) BEFORE playlists, both BEFORE tracks/users.
    // The composite FK playlist_tracks.playlist_id -> playlists.id and the
    // RESTRICT FK playlist_tracks.track_id -> tracks.id require this order.
    // The explicit CASCADE would handle it defensively, but the literal
    // ordering documents intent and survives a future CASCADE removal.
    const requiredTables = ['"playlist_tracks"', '"playlists"'];
    for (const table of requiredTables) {
      expect(
        source,
        `truncate must include ${table} so playlists tests start from a clean slate`,
      ).toContain(table);
    }
    // Junction-first ordering: "playlist_tracks" must appear before "playlists"
    // in the TRUNCATE statement.
    const junctionIdx = source.indexOf('"playlist_tracks"');
    const playlistsIdx = source.indexOf('"playlists"');
    expect(junctionIdx, 'playlist_tracks must be in the TRUNCATE').toBeGreaterThanOrEqual(0);
    expect(playlistsIdx, 'playlists must be in the TRUNCATE').toBeGreaterThan(junctionIdx);
  });

  it('test-db truncate covers user_library_albums junction-first (F6 — design §11.3 item 2)', () => {
    const testDbPath = resolve(process.cwd(), 'test/helpers/test-db.ts');
    expect(existsSync(testDbPath), 'test/helpers/test-db.ts must exist').toBe(true);
    const source = readFileSync(testDbPath, 'utf8');

    // user_library_albums (junction) BEFORE playlist_tracks AND both of its
    // parents (users, albums) — the FKs user_library_albums.user_id ->
    // users.id and user_library_albums.album_id -> albums.id (both CASCADE)
    // require this order defensively, mirroring the F5 junction-first rule.
    expect(
      source,
      'truncate must include "user_library_albums" so library tests start clean',
    ).toContain('"user_library_albums"');

    const truncateStmt = source.slice(source.indexOf('TRUNCATE TABLE'));
    const junctionIdx = truncateStmt.indexOf('"user_library_albums"');
    expect(junctionIdx, 'user_library_albums must be in the TRUNCATE').toBeGreaterThanOrEqual(0);
    for (const parent of ['"playlist_tracks"', '"users"', '"albums"']) {
      const parentIdx = truncateStmt.indexOf(parent);
      expect(parentIdx, `${parent} must be in the TRUNCATE`).toBeGreaterThan(junctionIdx);
    }
  });

  it('requires LibraryRepositoryPort to be a framework-free interface under domain/ports (F6 — design §11.3 item 1)', () => {
    const portPath = 'contexts/library/domain/ports/library-repository.port.ts';
    const absolute = resolve(srcRoot, portPath);
    expect(existsSync(absolute), `expected port file ${portPath}`).toBe(true);

    const source = loadSourceFile(absolute);

    const interfaceNames = source.getInterfaces().map((i) => i.getName());
    expect(
      interfaceNames,
      'LibraryRepositoryPort must be declared as an interface',
    ).toContain('LibraryRepositoryPort');

    const classesNamedPort = source
      .getClasses()
      .map((c) => c.getName())
      .filter((n): n is string => Boolean(n) && n === 'LibraryRepositoryPort');
    expect(classesNamedPort, 'LibraryRepositoryPort must not be a class').toEqual([]);

    // Framework-free (mirrors the playlists port-shape assertion): pure TS
    // interface, zero NestJS / Prisma / express / rxjs / pino imports.
    const forbidden = ['@prisma/client', '@nestjs/common', '@nestjs/core', 'prisma', 'express', 'rxjs', 'pino'];
    for (const declaration of source.getImportDeclarations()) {
      const specifier = declaration.getModuleSpecifierValue();
      for (const banned of forbidden) {
        expect(
          specifier,
          `LibraryRepositoryPort must not import "${banned}" (pure TS interface, framework-free)`,
        ).not.toContain(banned);
      }
    }
  });

  it('forbids library code from importing the playlists context (F6 — REQ-L-007 isolation scan)', () => {
    // REQ-L-007: the library context MUST NOT read, aggregate, or depend on
    // the playlists context — the unified view is composed client-side.
    // Scans every production source under contexts/library/ for relative
    // imports resolving into contexts/playlists/ (trivially green while the
    // context is empty; guards from now on).
    const offenders: string[] = [];
    for (const file of contextFiles) {
      const rel = relOf(file);
      if (rel.split('/')[1] !== 'library') continue;
      const source = loadSourceFile(file);
      for (const declaration of source.getImportDeclarations()) {
        const specifier = declaration.getModuleSpecifierValue();
        if (!specifier.startsWith('.')) continue;
        const resolved = resolve(dirname(file), specifier);
        const target = posix(relative(srcRoot, resolved));
        if (target.split('/')[1] === 'playlists') {
          offenders.push(rel + ' imports "' + specifier + '" (crosses into playlists)');
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('library controller declares only library/albums routes (F6 — REQ-L-007 route-surface scan, design §11.3 item 3b)', () => {
    // REQ-L-007 "No library endpoint aggregates playlists" as a STRUCTURAL
    // guarantee: the controller's declared route strings must be exactly the
    // three library surfaces — GET 'library/albums' + the POST/DELETE
    // 'library/albums/:albumId' pair. Any playlists (or other-context) route
    // string here fails the scan.
    const controllerPath = 'contexts/library/infrastructure/library.controller.ts';
    const absolute = resolve(srcRoot, controllerPath);
    expect(existsSync(absolute), `expected controller file ${controllerPath}`).toBe(true);

    const source = readFileSync(absolute, 'utf8');
    const routeStrings = [...source.matchAll(/@(Get|Post|Patch|Put|Delete)\('([^']+)'\)/g)].map(
      (m) => m[2],
    );

    expect(routeStrings.sort(), 'the controller must declare exactly the three library routes').toEqual(
      ['library/albums', 'library/albums/:albumId', 'library/albums/:albumId'],
    );

    // Belt-and-braces: no route string may reference another context.
    for (const route of routeStrings) {
      expect(route, `route "${route}" must be library-scoped (REQ-L-007)`).toMatch(
        /^library\/albums(\/:albumId)?$/,
      );
    }
  });

  it('requires Playlist entity to expose static create/reconstruct + instance rename/ensureOwnedBy (F5 — design §14.5)', () => {
    const playlistPath = 'contexts/playlists/domain/playlist.entity.ts';
    const absolute = resolve(srcRoot, playlistPath);
    expect(existsSync(absolute), `expected entity file ${playlistPath}`).toBe(true);

    const source = loadSourceFile(absolute);
    const cls = source.getClasses().find((c) => c.getName() === 'Playlist');
    expect(cls, 'Playlist class must exist').toBeDefined();

    // static create — validating factory (LOCKED product #5).
    const create = cls!.getMethods().find((m) => m.getName() === 'create');
    expect(create, 'Playlist must declare a create() method').toBeDefined();
    expect(create!.isStatic(), 'Playlist.create must be static').toBe(true);

    // static reconstruct — trusted hydration (mirrors User.reconstruct).
    const reconstruct = cls!.getMethods().find((m) => m.getName() === 'reconstruct');
    expect(reconstruct, 'Playlist must declare a reconstruct() method').toBeDefined();
    expect(reconstruct!.isStatic(), 'Playlist.reconstruct must be static').toBe(true);

    // instance rename — mutates title, same 1..100 invariant.
    const rename = cls!.getMethods().find((m) => m.getName() === 'rename');
    expect(rename, 'Playlist must declare a rename() method').toBeDefined();
    expect(rename!.isStatic(), 'Playlist.rename must be an instance method').toBe(false);

    // instance ensureOwnedBy — LOCKED design R2: ownership invariant on entity.
    const ensureOwnedBy = cls!.getMethods().find((m) => m.getName() === 'ensureOwnedBy');
    expect(ensureOwnedBy, 'Playlist must declare an ensureOwnedBy() method').toBeDefined();
    expect(ensureOwnedBy!.isStatic(), 'Playlist.ensureOwnedBy must be an instance method').toBe(false);
  });

  it('requires PlaylistsRepositoryPort to be a framework-free interface under domain/ports (F5 — design §14.5)', () => {
    const portPath = 'contexts/playlists/domain/ports/playlists-repository.port.ts';
    const absolute = resolve(srcRoot, portPath);
    expect(existsSync(absolute), `expected port file ${portPath}`).toBe(true);

    const source = loadSourceFile(absolute);

    // Must declare the interface (mirrors the catalog port-shape assertion).
    const interfaceNames = source.getInterfaces().map((i) => i.getName());
    expect(
      interfaceNames,
      'PlaylistsRepositoryPort must be declared as an interface',
    ).toContain('PlaylistsRepositoryPort');

    // Must NOT be a class — a class would bypass the "every Port is a TS
    // interface" rule and let the application layer depend on a concrete type.
    const classesNamedPort = source
      .getClasses()
      .map((c) => c.getName())
      .filter((n): n is string => Boolean(n) && n === 'PlaylistsRepositoryPort');
    expect(classesNamedPort, 'PlaylistsRepositoryPort must not be a class').toEqual([]);

    // Framework-free (mirrors the catalog read-models + pagination check):
    // pure TS interface, zero NestJS / Prisma / express / rxjs / pino imports.
    const forbidden = ['@prisma/client', '@nestjs/common', '@nestjs/core', 'prisma', 'express', 'rxjs', 'pino'];
    for (const declaration of source.getImportDeclarations()) {
      const specifier = declaration.getModuleSpecifierValue();
      for (const banned of forbidden) {
        expect(
          specifier,
          `PlaylistsRepositoryPort must not import "${banned}" (pure TS interface, framework-free)`,
        ).not.toContain(banned);
      }
    }
  });

  // ---------------------------------------------------------------------------
  // Catalog PR-2a extensions (CAT-PR2a-13, per R2-CRIT-3).
  // These four assertions land here — NOT in PR-1 — because they guard catalog
  // domain artefacts (entities / read-models / port / shared pagination) that
  // only exist after PR-2a. NO search assertions yet (those land in PR-3c).
  // ---------------------------------------------------------------------------

  it('requires catalog entities to expose static reconstruct methods (CAT-PR2a-13)', () => {
    const expected = [
      { name: 'Artist', path: 'contexts/catalog/domain/artist.entity.ts' },
      { name: 'Album', path: 'contexts/catalog/domain/album.entity.ts' },
      { name: 'Track', path: 'contexts/catalog/domain/track.entity.ts' },
    ] as const;

    for (const { name, path } of expected) {
      const absolute = resolve(srcRoot, path);
      expect(existsSync(absolute), `expected entity file ${path}`).toBe(true);
      const source = loadSourceFile(absolute);

      const cls = source
        .getClasses()
        .find((c) => c.getName() === name);
      expect(cls, `${name} class must exist in ${path}`).toBeDefined();

      // `reconstruct` MUST be declared as a static method on the class.
      const reconstruct = cls!.getMethods().find((m) => m.getName() === 'reconstruct');
      expect(reconstruct, `${name} must declare a reconstruct() method`).toBeDefined();
      expect(
        reconstruct!.getScope(),
        `${name}.reconstruct must be static`,
      ).toBe('public');
      // ts-morph reports static methods via isStatic — getScope returns the
      // access modifier, so also assert isStatic directly.
      expect(reconstruct!.isStatic(), `${name}.reconstruct must be static`).toBe(true);
    }
  });

  it('catalog read-models live in domain and stay framework-free (CAT-PR2a-13)', () => {
    const readModelsPath = resolve(srcRoot, 'contexts/catalog/domain/read-models.ts');
    expect(existsSync(readModelsPath), 'contexts/catalog/domain/read-models.ts must exist').toBe(true);

    const source = loadSourceFile(readModelsPath);
    const forbidden = ['@prisma/client', '@nestjs/common', '@nestjs/core', 'prisma'];
    for (const declaration of source.getImportDeclarations()) {
      const specifier = declaration.getModuleSpecifierValue();
      for (const banned of forbidden) {
        expect(
          specifier,
          `catalog read-models must not import "${banned}" (pure TS projection types)`,
        ).not.toContain(banned);
      }
    }
  });

  it('shared/pagination.ts stays framework-free (CAT-PR2a-13)', () => {
    const paginationPath = resolve(srcRoot, 'shared/pagination.ts');
    expect(existsSync(paginationPath), 'shared/pagination.ts must exist').toBe(true);

    const source = loadSourceFile(paginationPath);
    const forbidden = ['@prisma/client', '@nestjs/common', '@nestjs/core', 'prisma'];
    for (const declaration of source.getImportDeclarations()) {
      const specifier = declaration.getModuleSpecifierValue();
      for (const banned of forbidden) {
        expect(
          specifier,
          `shared/pagination.ts must not import "${banned}" (single source of truth for DTO + use cases)`,
        ).not.toContain(banned);
      }
    }
  });
});
