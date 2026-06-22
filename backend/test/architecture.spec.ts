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

  it('keeps the domain layer free of any non-relative (framework) import', () => {
    const violations: string[] = [];
    for (const file of domainFiles) {
      const source = loadSourceFile(file);
      for (const declaration of source.getImportDeclarations()) {
        const specifier = declaration.getModuleSpecifierValue();
        if (!specifier.startsWith('.')) {
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

  it('declares the four expected Driven Ports as interfaces under domain/ports', () => {
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
});
