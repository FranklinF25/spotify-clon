import { describe, expect, it } from 'vitest';

import { RangeParserAdapter } from './range-parser.adapter';

/**
 * Unit spec for `RangeParserAdapter` (PB-PR1-08).
 *
 * Covers REQ-PLAY-004 exhaustively — the 7 scenarios that drive every
 * status-code path downstream:
 *
 *   1. no Range header          → `{ ok: true, range: null }` (200 path)
 *   2. closed `bytes=0-1023`    → `{ ok: true, range: { start, end, total } }` (206)
 *   3. open   `bytes=500-`      → end clamped to size-1 (206)
 *   4. suffix `bytes=-500`      → last 500 bytes (206)
 *   5. invalid `bytes=abc`      → sentinel -2 → `{ ok: false, reason: 'invalid' }` (400)
 *   6. unsatisfiable            → sentinel -1 → `{ ok: false, reason: 'unsatisfiable', total }` (416)
 *   7. multi-range              → length > 1 → `{ ok: false, reason: 'multi-range' }` (400)
 *
 * Asserts the literal-string discriminants (W-vocab-drift — the spec's
 * `InvalidRange` / `UnsatisfiableRange` markers are conceptual aliases; the
 * runtime values are the string literals below).
 */
describe('RangeParserAdapter', () => {
  const adapter = new RangeParserAdapter();

  describe('REQ-PLAY-004 — Range header parsing', () => {
    it('1. returns ok:true with range=null when no Range header is present (200 path)', () => {
      const result = adapter.parse(1024, undefined);

      expect(result).toEqual({ ok: true, range: null });
    });

    it('1b. treats an empty string header the same as undefined (defensive)', () => {
      // An empty `Range` header is semantically absent — the use case must
      // still answer 200 full-content. The adapter treats every falsy value
      // uniformly.
      const result = adapter.parse(1024, '');

      expect(result).toEqual({ ok: true, range: null });
    });

    it('2. parses a closed range bytes=0-1023 on a 1024-byte file (206 path)', () => {
      const result = adapter.parse(1024, 'bytes=0-1023');

      expect(result).toEqual({ ok: true, range: { start: 0, end: 1023, total: 1024 } });
    });

    it('3. parses an open range bytes=500- (end clamped to size-1)', () => {
      const result = adapter.parse(1024, 'bytes=500-');

      expect(result).toEqual({ ok: true, range: { start: 500, end: 1023, total: 1024 } });
    });

    it('4. parses a suffix range bytes=-500 (last 500 bytes)', () => {
      const result = adapter.parse(1024, 'bytes=-500');

      // 1024 - 500 = 524 (start), 1023 (end - last byte index)
      expect(result).toEqual({ ok: true, range: { start: 524, end: 1023, total: 1024 } });
    });

    it('5. maps a syntactically invalid header (bytes=abc) to reason="invalid" (400 path)', () => {
      // `range-parser` returns -2 for any header missing `=` or otherwise
      // unparseable. The adapter normalises that to the domain union.
      const result = adapter.parse(1024, 'bytes=abc');

      expect(result).toEqual({ ok: false, reason: 'invalid' });
    });

    it('5b. maps a header missing the `=` separator to reason="invalid"', () => {
      // No `=` in the header → range-parser returns -2.
      const result = adapter.parse(1024, 'invalid-no-equals-sign');

      expect(result).toEqual({ ok: false, reason: 'invalid' });
    });

    it('6. maps an unsatisfiable range (bytes=999999- on a 1000-byte file) to reason="unsatisfiable" with total (416 path)', () => {
      const result = adapter.parse(1000, 'bytes=999999-');

      expect(result).toEqual({ ok: false, reason: 'unsatisfiable', total: 1000 });
    });

    it('7. rejects a multi-range header (bytes=0-10,20-30) with reason="multi-range" (400 path)', () => {
      // HTTP permits servers to refuse multipart responses. The playback
      // context refuses — multi-range would require a multipart/byteranges
      // encoder this change explicitly excludes.
      const result = adapter.parse(1024, 'bytes=0-10,20-30');

      expect(result).toEqual({ ok: false, reason: 'multi-range' });
    });
  });

  describe('discriminant contract', () => {
    // The downstream use case + controller narrow on `result.ok` then on
    // `result.reason` / `result.range`. These guards lock the discriminants.

    it('the invalid reason is exactly the literal "invalid" (NOT a PascalCase marker)', () => {
      const result = adapter.parse(1024, 'bytes=abc');
      if (!result.ok) {
        expect(result.reason).toBe('invalid');
        // Narrowing: `total` MUST NOT be present on the invalid branch.
        expect(result).not.toHaveProperty('total');
      }
    });

    it('the unsatisfiable branch carries the file size as total (drives the 416 Content-Range header)', () => {
      const result = adapter.parse(1000, 'bytes=999999-');
      if (!result.ok) {
        expect(result.reason).toBe('unsatisfiable');
        expect(result.total).toBe(1000);
      }
    });

    it('the multi-range reason is exactly the literal "multi-range"', () => {
      const result = adapter.parse(1024, 'bytes=0-10,20-30');
      if (!result.ok) {
        expect(result.reason).toBe('multi-range');
      }
    });
  });
});
