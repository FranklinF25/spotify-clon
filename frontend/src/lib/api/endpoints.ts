/**
 * Single source of truth for every backend path the SPA calls (DESIGN §6.4).
 *
 * `BASE` defaults to `/api/v1` (same-origin through the Vite proxy, FE-PR1-02).
 * `VITE_API_BASE_URL` is typed in `src/types/env.d.ts` (string); the `??` here
 * is belt-and-suspenders for the unset case so a reader never has to reason
 * about `undefined`.
 *
 * IDs are `encodeURIComponent`-ed. `search.type` is SINGULAR
 * ('artist' | 'album' | 'track') mirroring backend `dto/search.dto.ts`
 * (`z.enum(['artist','album','track']).optional()`) — NOT a comma-joined plural.
 */
const BASE = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';

export const endpoints = {
  auth: {
    register: `${BASE}/auth/register`,
    login: `${BASE}/auth/login`,
    refresh: `${BASE}/auth/refresh`,
    logout: `${BASE}/auth/logout`,
  },
  me: `${BASE}/me`,
  artists: {
    // Two positional args (page, pageSize) — DESIGN §5.1 commentary. The
    // query key in TanStack hooks is built from a parsed {page,pageSize}
    // object so cache identity stays stable across re-renders.
    list: (page = 1, pageSize = 20) =>
      `${BASE}/artists?page=${page}&pageSize=${pageSize}`,
    detail: (id: string) => `${BASE}/artists/${encodeURIComponent(id)}`,
  },
  albums: {
    list: (page = 1, pageSize = 20) =>
      `${BASE}/albums?page=${page}&pageSize=${pageSize}`,
    detail: (id: string) => `${BASE}/albums/${encodeURIComponent(id)}`,
  },
  tracks: {
    detail: (id: string) => `${BASE}/tracks/${encodeURIComponent(id)}`,
    stream: (id: string) =>
      `${BASE}/tracks/${encodeURIComponent(id)}/stream`,
  },
  // `type` is SINGULAR. Serialised as a single `&type=artist`, NOT a
  // comma-joined plural (JD fix #1 — backend dto/search.dto.ts uses
  // `z.enum(['artist','album','track']).optional()`).
  search: (q: string, type?: 'artist' | 'album' | 'track') =>
    `${BASE}/search?q=${encodeURIComponent(q)}` +
    (type ? `&type=${type}` : ''),
  // Playlists namespace (PR-3; DESIGN §12.5). Mirrors the artists/albums
  // shape. `reorder` is HTTP 200 (NOT 201 — backend @HttpCode(200), see PR-2
  // fix `619c7c8`). IDs are encodeURIComponent-ed; `removeTrack` takes the
  // numeric position as the LAST path segment (raw — positions are integers).
  playlists: {
    list: `${BASE}/playlists`,
    detail: (id: string) => `${BASE}/playlists/${encodeURIComponent(id)}`,
    create: `${BASE}/playlists`,
    rename: (id: string) => `${BASE}/playlists/${encodeURIComponent(id)}`,
    remove: (id: string) => `${BASE}/playlists/${encodeURIComponent(id)}`,
    tracks: (id: string) =>
      `${BASE}/playlists/${encodeURIComponent(id)}/tracks`,
    addTrack: (id: string) =>
      `${BASE}/playlists/${encodeURIComponent(id)}/tracks`,
    removeTrack: (id: string, position: number) =>
      `${BASE}/playlists/${encodeURIComponent(id)}/tracks/${position}`,
    reorder: (id: string) =>
      `${BASE}/playlists/${encodeURIComponent(id)}/reorder`,
  },
};
