import getRange from 'range-parser';

import type { RangeParserPort } from '../domain/ports/range-parser.port';
import type { RangeParseResult } from '../domain/types';

/**
 * RFC 7233 §2.1 bytes-range grammar, restricted to the subset the playback
 * API accepts:
 *   bytes-range = "bytes=" first-byte-pos "-" [ last-byte-pos ]
 *                ( "," first-byte-pos "-" [ last-byte-pos ] )*
 * Each range token MUST contain at least one digit on one side of the dash.
 *
 * `range-parser` v1.2.1 conflates malformed input (`bytes=abc`) with
 * unsatisfiable input (`bytes=999999-`) into the `-1` sentinel. The spec
 * (REQ-PLAY-004) distinguishes `invalid` (→ 400 ValidationError) from
 * `unsatisfiable` (→ 416 Content-Range). This regex pre-validates the
 * header syntax so the library's `-1` reliably means "syntactically valid
 * but out-of-range" → `unsatisfiable`, and any non-conforming header
 * becomes `invalid` BEFORE we hand off to the library.
 */
const RANGE_TOKEN = /\d+-\d+|\d+-|-\d+/;
const RANGE_HEADER_SYNTAX = new RegExp(
  `^\\s*bytes\\s*=\\s*(?:${RANGE_TOKEN.source})(?:\\s*,\\s*(?:${RANGE_TOKEN.source}))*\\s*$`,
  'i',
);

/**
 * Driven adapter (infrastructure) wrapping the `range-parser` package —
 * Decision #1 (Approach D) of the playback proposal.
 *
 * `range-parser` is the same Express-ecosystem parser that powers
 * `express.static`'s Range support. Zero transitive dependencies, battle-
 * tested, RFC 7233 aligned. The adapter is intentionally thin: its only job
 * is to translate the library's sentinel return values (`-2` malformed,
 * `-1` unsatisfiable) plus its array-of-ranges result into the
 * `RangeParseResult` union the domain understands. The semantic decisions
 * live in the domain union; the adapter just maps shape.
 *
 * Implements `RangeParserPort` (C1 fix) — the use case depends on the
 * port, not on this concrete class. `PlaybackModule` (PR-2) binds the
 * `RANGE_PARSER_PORT` token to this adapter via `useFactory`.
 */
export class RangeParserAdapter implements RangeParserPort {
  parse(size: number, header: string | undefined): RangeParseResult {
    // No Range header → full-content 200 path. Also defends against the
    // library's `typeof str !== 'string'` TypeError — calling `getRange`
    // with `undefined` would throw, so the falsy guard MUST come first.
    if (!header) return { ok: true, range: null };

    // Pre-validate syntax (see RANGE_HEADER_SYNTAX rationale above).
    if (!RANGE_HEADER_SYNTAX.test(header)) {
      return { ok: false, reason: 'invalid' };
    }

    // `combine: false` is EXPLICIT so adjacent ranges stay separate and
    // trigger the multi-range 400 path below. The library default is
    // already false, but stating it makes the contract obvious and
    // protects against a future upstream default flip.
    const result = getRange(size, header, { combine: false });

    // Sentinels — `range-parser` returns numbers for the failure modes.
    if (result === -2) return { ok: false, reason: 'invalid' };
    if (result === -1) return { ok: false, reason: 'unsatisfiable', total: size };

    // Defensive: an unexpected empty array is treated as "no usable range"
    // — semantically equivalent to no Range header (200 path). Should not
    // happen in practice with `range-parser` v1.2.x.
    if (!Array.isArray(result) || result.length === 0) {
      return { ok: true, range: null };
    }

    // Multi-range request (e.g. `bytes=0-10,20-30`). HTTP permits servers
    // to refuse multipart responses; playback refuses — the
    // multipart/byteranges encoder is explicitly out of scope (Q2).
    if (result.length > 1) return { ok: false, reason: 'multi-range' };

    const r = result[0]!;
    return { ok: true, range: { start: r.start, end: r.end, total: size } };
  }
}
