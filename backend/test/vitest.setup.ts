/**
 * Shared Vitest setup applied to every project before specs run.
 *
 * Keeps the global Node environment deterministic (no stray timers, no leaked
 * request-context). Extend here as cross-cutting test concerns grow.
 */
import { afterEach } from 'vitest';

afterEach(() => {
  // No global state to reset yet for PR-1; placeholder keeps the setup file
  // referenced by all projects and gives later slices a single hook.
});
