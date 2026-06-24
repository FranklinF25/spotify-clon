import { setupServer } from 'msw/node';
import { handlers } from './handlers';

/**
 * The MSW server used by every integration/contract spec. Specs enable/listen
 * per test via `beforeAll(() => server.listen())`, `afterEach(() =>
 * server.resetHandlers())`, `afterAll(() => server.close())` — wired in the
 * contract suites (FE-PR1-11) and the http-client/blob-source specs.
 */
export const server = setupServer(...handlers);
