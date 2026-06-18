import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Architecture portfolio test — starter version (BF-07).
 *
 * BF-09 expands this into the full DESIGN §3.4 guard (domain import-clean,
 * `*Port` is an interface, `*UseCase` has exactly one `execute()`, controllers
 * only in infrastructure). It must stay green against the current empty
 * identity tree and grow as identity lands.
 */
const srcRoot = resolve(process.cwd(), 'src');

describe('architecture portfolio (starter — expanded in BF-09)', () => {
  it('exposes all five bounded contexts', () => {
    for (const ctx of ['identity', 'catalog', 'playback', 'playlists', 'library']) {
      expect(existsSync(resolve(srcRoot, 'contexts', ctx))).toBe(true);
    }
  });

  it('exposes the shared kernel', () => {
    expect(existsSync(resolve(srcRoot, 'shared'))).toBe(true);
  });
});
