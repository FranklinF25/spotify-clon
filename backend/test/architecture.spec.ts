import { existsSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { Project, SyntaxKind } from 'ts-morph';
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

function sourceEntries(): string[] {
  if (!existsSync(srcRoot)) return [];
  return (readdirSync(srcRoot, { recursive: true }) as string[])
    .map((entry) => posix(entry))
    .filter((entry) => isTypeScript(entry));
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
    expect(SyntaxKind.Decorator).toBeDefined();
    expect(offenders).toEqual([]);
  });
});
