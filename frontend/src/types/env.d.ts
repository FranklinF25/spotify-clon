/// <reference types="vite/client" />

/**
 * Typed Vite env. `VITE_API_BASE_URL` defaults to `/api/v1` at runtime in
 * `endpoints.ts` (DESIGN §6.4), so it is ALWAYS a string (possibly unset in
 * dev, which is why it is declared `string` not `string | undefined` — the
 * fallback handles the unset case before any read).
 *
 * REQ-FE-001 scenario "@/ alias and typed env resolve at build time".
 */
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
