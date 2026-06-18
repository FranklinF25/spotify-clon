/**
 * Shared Vitest setup applied to every project before specs run.
 *
 * Currently a no-op hook reserved for cross-cutting test concerns (timer
 * cleanup, request-context reset, etc.). It is referenced by every Vitest
 * project so later slices have a single extension point.
 */
export {};
