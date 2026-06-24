import { readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Portfolio architecture guard (DESIGN §10). Part 1 — two static assertions.
 * Part 2 (the `<PlayerBar/>` single-mount RUNTIME test) lands in FE-PR4-04
 * when `AppLayout` + the real `PlayerBar` exist (sequencing refinement noted
 * in tasks.md — the original proposal forecast put it in PR-1, but it is
 * unsatisfiable before PR-3/PR-4).
 */
const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, '..'); // frontend/src

describe('architecture — Part 1 (DESIGN §10)', () => {
  it('types/api.ts contains NO `filePath` field (REQ-FE-004)', () => {
    // Scoped to this ONE file's content — NOT a tree-wide grep, which would
    // false-positive on docs/comments elsewhere. The backend's internal
    // storage path is not part of the public contract.
    const source = readFileSync(resolve(SRC, 'types/api.ts'), 'utf8');
    expect(source).not.toMatch(/filePath/);
  });

  it('components/{atoms,molecules} never import from features/ | pages/ | store/ (§3 dependency rule)', () => {
    // §3: features import from components/ + lib/; components/ NEVER imports
    // from features/. Organisms are OUT of this check — PlayerBar legitimately
    // reads playerStore (JD fix #19). Test files are excluded: a *.spec.tsx
    // rendering inside a MemoryRouter would false-positive on react-router.
    const forbidden = /from\s+['"][^'"]*?\b(?:features|pages|store)\//;
    const offenders: string[] = [];
    for (const tier of ['atoms', 'molecules']) {
      const dir = resolve(SRC, 'components', tier);
      let entries: string[];
      try {
        entries = readdirSync(dir, { recursive: true }).map(String);
      } catch {
        // The dir does not exist yet in PR-1 (atoms/molecules land in PR-3).
        // The assertion passes vacuously now and gates these tiers as they
        // arrive — it will start enforcing the moment a file lands here.
        continue;
      }
      const sourceFiles = entries
        .filter((f) => /\.(ts|tsx)$/.test(f))
        .filter((f) => !/\.(spec|test)\./.test(f));
      for (const f of sourceFiles) {
        const content = readFileSync(resolve(dir, f), 'utf8');
        if (forbidden.test(content)) {
          offenders.push(relative(SRC, resolve(dir, f)));
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
