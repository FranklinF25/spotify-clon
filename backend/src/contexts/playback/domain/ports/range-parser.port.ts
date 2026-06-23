import type { RangeParseResult } from '../types';

/**
 * Driven port (secondary) that translates an HTTP `Range` header into a
 * `RangeParseResult` against a known file size.
 *
 * Lives in the DOMAIN layer (not infrastructure) so the application use case
 * can depend on it without importing infrastructure (C1 fix from Judgment
 * Day Round 1 — otherwise the use case would import `parseRange` from
 * `infrastructure/`, violating `architecture.spec.ts:162-181` which forbids
 * `application → infrastructure` imports AND REQ-PLAY-002 which requires
 * the use case to depend on this port).
 *
 * Production implementation: `RangeParserAdapter` wrapping the
 * `range-parser` package (Approach D, Decision #1). Test fakes return
 * canned `RangeParseResult` values for unit-spec coverage of every status
 * code path.
 *
 * Framework-free by design: pure TS interface, zero runtime framework imports.
 */
export interface RangeParserPort {
  /**
   * Parse an HTTP `Range` header against a file of `size` bytes.
   *
   * `header` is `undefined` when the client sent no `Range` header — the
   * implementation MUST return `{ ok: true, range: null }` in that case
   * (the use case maps this to a 200 full-content response).
   */
  parse(size: number, header: string | undefined): RangeParseResult;
}
