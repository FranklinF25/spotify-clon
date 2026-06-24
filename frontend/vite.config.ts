/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

/**
 * Vite dev-server + Vitest config (DESIGN §6.5 + §10).
 *
 * The dev proxy is the locked fix for the doubly-broken cross-origin case
 * (backend has zero CORS config AND the refresh cookie is `SameSite=Lax`):
 * the browser talks same-origin to `:5173` and Vite forwards `/api` +
 * `/health` to `:3000`.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    proxy: {
      // NO `rewrite` key — the full /api/v1/... path MUST reach the backend
      // unchanged so the refresh cookie (`path=/api/v1/auth`) is attached on
      // `/api/v1/auth/refresh` (REQ-FE-001 scenario "Dev proxy preserves the
      // /api/v1 path"). proxy.config.spec.ts asserts this no-rewrite contract.
      //
      // COOKIE_SECURE gotcha (DESIGN §11.5): the backend refresh cookie is
      // `Secure`-conditional on backend env; over plain HTTP dev the browser
      // refuses to store it unless COOKIE_SECURE=false is set on the BACKEND.
      // MARKER: COOKIE_SECURE=false required for HTTP dev (Camino A)
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/health': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
  // Vitest config co-located (DESIGN §10): jsdom so RTL renders; globals so
  // specs skip the `import { describe, it, expect }` boilerplate; css:false
  // because CSS Modules are not asserted on in Slice A; setupFiles wires
  // jest-dom matchers + per-test cleanup/store reset (FE-PR1-07).
  test: {
    environment: 'jsdom',
    globals: true,
    css: false,
    setupFiles: ['./src/test/setup.ts'],
  },
});
