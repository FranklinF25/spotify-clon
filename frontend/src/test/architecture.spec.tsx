import { readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/store/auth.store';
import { AppLayout } from '@/components/templates/AppLayout/AppLayout';

/**
 * Portfolio architecture guard (DESIGN §10).
 *  - Part 1 — two static assertions: filePath regex + atoms/molecules
 *    dependency direction.
 *  - Part 2 — PlayerBar single-mount RUNTIME assertion (FE-PR4-04): render
 *    <AppLayout/>, navigate between routes, assert the <audio> element
 *    identity is STABLE. The static "imported by exactly one module"
 *    version was unsatisfiable because useAudioSource is co-located with
 *    PlayerBar; the runtime test is the stronger guarantee anyway
 *    (REQ-FE-008 scenario "PlayerBar is mounted exactly once in AppLayout").
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

describe('architecture — Part 2: PlayerBar single-mount RUNTIME (DESIGN §10, REQ-FE-008)', () => {
  // REQ-FE-008 scenario "PlayerBar is mounted exactly once in AppLayout".
  // The entire protected route table is nested under one <AppLayout/>
  // element, so React Router keeps the layout (and therefore PlayerBar's
  // <audio> ref) mounted across `/home` <-> `/albums/:id` <-> `/artists/:id`
  // navigation. The assertion is RUNTIME (same DOM node across navigations),
  // not a static "imported by exactly one module" count — the latter is
  // unsatisfiable because useAudioSource is co-located with PlayerBar.

  it('the <audio> element identity is stable across route navigations', async () => {
    // Bypass RequireAuth so AppLayout renders. RequireAuth reads
    // authStore.status; an authenticated status lets it through.
    useAuthStore.setState({
      status: 'authenticated',
      user: {
        id: 'u1',
        email: 'u@e.co',
        displayName: 'U',
      },
      accessToken: 'T',
    });

    // Expose the router's `navigate` to the test via a capture ref. MemoryRouter
    // owns its history internally; `window.history.pushState` does NOT drive it.
    // A tiny harness component inside the router calls `useNavigate()` and
    // forwards it out so the test can drive real router transitions.
    let navigate: ((to: string) => void) | null = null;
    function NavigateProbe() {
      navigate = useNavigate();
      return null;
    }

    render(
      <MemoryRouter initialEntries={['/home']}>
        <NavigateProbe />
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/home" element={<div data-testid="home">Home</div>} />
            <Route
              path="albums/:id"
              element={<div data-testid="album">Album</div>}
            />
            <Route
              path="artists/:id"
              element={<div data-testid="artist">Artist</div>}
            />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    // Find the audio element on the home route.
    const audioOnHome = await screen.findByTestId('player-audio');
    expect(audioOnHome).toBeInTheDocument();

    // Navigate via the router's own history — AppLayout stays mounted, so the
    // same <audio> node should still be in the document.
    navigate!('/albums/123');
    await waitFor(() =>
      expect(screen.getByTestId('album')).toBeInTheDocument(),
    );
    // SAME DOM node — PlayerBar was NOT remounted.
    expect(screen.getByTestId('player-audio')).toBe(audioOnHome);

    navigate!('/artists/456');
    await waitFor(() =>
      expect(screen.getByTestId('artist')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('player-audio')).toBe(audioOnHome);
  });
});
