import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { resetStores } from './resetStores';

/**
 * Vitest global setup (DESIGN §10). Loaded once per test file via
 * `setupFiles` in vite.config.ts.
 *
 * - `@testing-library/jest-dom/vitest` augments `expect` with DOM matchers
 *   (`toBeInTheDocument`, `toHaveAttribute`, ...).
 * - `afterEach` runs RTL `cleanup` (unmounts rendered components) +
 *   `resetStores` (zeroes authStore + localStorage) so each test starts clean.
 * - URL.createObjectURL/revokeObjectURL stubs: jsdom does not implement them;
 *   the blob path (FE-PR1-10 `loadBlobSource`, PR-4 `useAudioSource`) needs
 *   them. Deterministic `blob:` URLs so revoke assertions can distinguish.
 */
URL.createObjectURL = vi.fn(() => 'blob:mock://deterministic-fixture');
URL.revokeObjectURL = vi.fn();

afterEach(() => {
  cleanup();
  resetStores();
});
