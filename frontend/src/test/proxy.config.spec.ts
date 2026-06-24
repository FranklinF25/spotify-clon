import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * CI safety net for the dev-proxy contract (DESIGN §11.4; R2-5).
 *
 * MSW cannot verify the real Vite proxy (it intercepts at the fetch layer, not
 * the dev-server layer), so this static assertion guards the two regressions
 * that would only surface at demo time:
 *   1. someone adds a `rewrite` to the `/api` proxy — breaking the refresh
 *      cookie's `path=/api/v1/auth` match (the browser would attach the cookie
 *      to the REWRITTEN path, which no longer matches → every refresh 401s);
 *   2. someone rewrites the COOKIE_SECURE gotcha out of README prose — so a
 *      future dev silently can't store the cookie over HTTP.
 *
 * Both assertions read the SOURCE file (not the runtime config object),
 * because (a) the MARKER is a comment stripped on import, and (b) anchoring
 * on a CODE-LEVEL marker (not README prose) is the whole point of R2-5.
 */
const __dirname = dirname(fileURLToPath(import.meta.url));
const viteConfigSource = readFileSync(
  resolve(__dirname, '../../vite.config.ts'),
  'utf8',
);

describe('vite.config.ts /api proxy contract (REQ-FE-001)', () => {
  it('the /api proxy entry exists and has NO `rewrite` key', () => {
    // Capture the body of the `'/api'` object literal — `[^}]*` stops at the
    // first closing brace (the object is flat, no nested braces). The comments
    // above the entry (which mention the word "rewrite") are OUTSIDE this
    // capture, so they do not false-positive.
    const match = viteConfigSource.match(/['"]\/api['"]\s*:\s*\{([^}]*)\}/s);
    expect(match, "expected a '/api' proxy entry in vite.config.ts").not.toBeNull();
    const apiProxyBody = match![1];
    expect(apiProxyBody).toContain('http://localhost:3000');
    expect(apiProxyBody).toContain('changeOrigin');
    // The critical contract: NO rewrite key (else the cookie path breaks).
    expect(apiProxyBody).not.toMatch(/\brewrite\b/);
  });

  it('anchors the COOKIE_SECURE gotcha on a CODE-LEVEL MARKER comment (R2-5)', () => {
    // Exact literal — a README reword cannot silently drop this. If this
    // fails, restore the structured comment in vite.config.ts (DESIGN §11.5).
    expect(viteConfigSource).toMatch(
      /MARKER: COOKIE_SECURE=false required for HTTP dev \(Camino A\)/,
    );
  });
});
