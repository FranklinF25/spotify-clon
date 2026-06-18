import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-request correlation context carried via Node AsyncLocalStorage.
 *
 * The request-id middleware populates this store for the lifetime of a
 * request so any logger call (deep in the call stack) can read the current
 * `requestId` without threading it through every function signature.
 */
export interface RequestContext {
  requestId: string;
}

export const requestContextStorage = new AsyncLocalStorage<RequestContext>();

/** Returns the requestId active for the current async context, if any. */
export function getCurrentRequestId(): string | undefined {
  return requestContextStorage.getStore()?.requestId;
}
