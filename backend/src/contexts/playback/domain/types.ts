// Structural types for the playback bounded context.
//
// Zero RUNTIME framework imports + zero RUNTIME `node:` imports — enforced
// by the architecture portfolio test (REQ-BF-008, extended to filter
// `import type` via ts-morph's `isTypeOnly`) and the domain ESLint rule
// (CRIT-2: `@typescript-eslint/no-restricted-imports` with
// `allowTypeImports: true` on `node:*`).
//
// `import type` is erased at compile time → no runtime `node:stream` import
// lands in the domain tree. The `AudioStream = Readable` alias lets the
// domain speak in domain terms while the infrastructure adapter returns a
// real `Readable` (structurally identical — no cast needed at the boundary).
import type { Readable } from 'node:stream';

/**
 * A closed byte range [start, end] over a file of `total` bytes.
 * Both bounds are INCLUSIVE (RFC 7233 §2.1).
 */
export interface RangeResult {
  start: number;
  end: number;
  total: number;
}

/**
 * Domain alias over the real Node stream type. The rest of the domain layer
 * speaks in domain terms (`AudioStream`); `import type` ensures no
 * `node:stream` runtime import lands in the domain tree (architecture test
 * stays green AND infrastructure gets real `Readable` typing — no
 * `as unknown as AudioStream` cast at the boundary).
 */
export type AudioStream = Readable;

/**
 * Successful stream outcome — ONLY two variants. The `'unsatisfiable'`
 * outcome is intentionally NOT a StreamResult variant (R5 Judgment Day fix):
 * it is returned by the use case as a sibling branch `{ status: 416, total }`
 * OUTSIDE the StreamResult wrapper. StreamResult only describes successful
 * (200 / 206) outcomes.
 */
export type StreamResult =
  | { kind: 'full'; stream: AudioStream; total: number }
  | { kind: 'partial'; stream: AudioStream; range: RangeResult };

/**
 * Result of parsing an HTTP `Range` header against a known file size.
 *
 * Vocabulary reconciliation (W-vocab-drift): the spec REQ-PLAY-004 scenarios
 * reference conceptual markers `InvalidRange` / `UnsatisfiableRange`. The
 * concrete TS union below uses string-literal discriminants (`'invalid'`,
 * `'unsatisfiable'`, `'multi-range'`) — these are the runtime equivalents of
 * the spec's named markers. Tests assert against the literal values; spec
 * writers should treat the PascalCase markers as conceptual aliases only.
 */
export type RangeParseResult =
  | { ok: true; range: RangeResult | null } // null = no Range header present
  | {
      ok: false;
      reason: 'invalid' | 'unsatisfiable' | 'multi-range';
      total?: number; // present only on 'unsatisfiable' (drives the 416 Content-Range)
    };
