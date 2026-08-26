import type { Response } from 'express';
import { PassThrough } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import type { StreamResult } from '../domain/types';
import { buildAudioHeaders, buildUnsatisfiableHeaders } from './build-audio-response';

/**
 * Unit spec for `build-audio-response.ts` (PB-PR2-04).
 *
 * Covers REQ-PLAY-005 — the header-shape contract for the three successful
 * "audio" responses (200 full, 206 partial, 416 unsatisfiable). The helper
 * narrows on `result.kind` (the StreamResult discriminant — R4 Judgment Day
 * fix: TS does NOT co-vary `status` with `kind`, so a `status`-only
 * discriminant would fail to typecheck the `.total` / `.range` access).
 *
 * The `res` mock captures every `setHeader` / `status` call so the spec
 * asserts the EXACT header names + values + status code that ship on each
 * path. Body bytes are out of scope here (covered by the controller spec).
 */
function makeResMock() {
  const headers = new Map<string, unknown>();
  const statusCalls: number[] = [];
  const res = {
    status: vi.fn((code: number) => {
      statusCalls.push(code);
      return res;
    }),
    setHeader: vi.fn((name: string, value: unknown) => {
      headers.set(name.toLowerCase(), value);
      return res;
    }),
    getHeader: (name: string) => headers.get(name.toLowerCase()),
    _headers: headers,
    _statusCalls: statusCalls,
  } as unknown as Response & {
    _headers: Map<string, unknown>;
    _statusCalls: number[];
  };
  return res;
}

function makeStream() {
  // A PassThrough stands in for a real Readable — the helper does not read
  // from it, it only forwards it inside the StreamResult.
  return new PassThrough();
}

describe('build-audio-response', () => {
  describe('buildAudioHeaders — 200 full body', () => {
    it("sets Accept-Ranges, Content-Type (from result.contentType), Content-Length (= total) and status 200; NO Content-Range", () => {
      const res = makeResMock();
      const stream = makeStream();
      const payload = {
        status: 200 as const,
        result: { kind: 'full' as const, stream, total: 1234, contentType: 'audio/flac' },
      };

      buildAudioHeaders(res, payload);

      expect(res._statusCalls).toEqual([200]);
      expect(res._headers.get('accept-ranges')).toBe('bytes');
      // REQ-PLAY-005 content-type fix — the header ECHOES the contentType
      // the caller constructed (here audio/flac, NOT a hardcoded audio/mpeg).
      expect(res._headers.get('content-type')).toBe('audio/flac');
      expect(res._headers.get('content-length')).toBe(1234);
      expect(res._headers.has('content-range')).toBe(false);
    });
  });

  describe('buildAudioHeaders — 206 partial', () => {
    it("sets Content-Range, Content-Length (= end - start + 1), Accept-Ranges, Content-Type and status 206", () => {
      const res = makeResMock();
      const stream = makeStream();
      const payload = {
        status: 206 as const,
        result: {
          kind: 'partial' as const,
          stream,
          range: { start: 0, end: 1023, total: 1234 },
          contentType: 'audio/mpeg',
        },
      };

      buildAudioHeaders(res, payload);

      expect(res._statusCalls).toEqual([206]);
      expect(res._headers.get('accept-ranges')).toBe('bytes');
      expect(res._headers.get('content-type')).toBe('audio/mpeg');
      expect(res._headers.get('content-range')).toBe('bytes 0-1023/1234');
      // Content-Length MUST equal end - start + 1 (RFC 7233 §4.2).
      expect(res._headers.get('content-length')).toBe(1024);
    });

    it("computes Content-Length correctly for non-zero start (e.g. bytes 500-1023 of 1234)", () => {
      const res = makeResMock();
      const stream = makeStream();
      const payload = {
        status: 206 as const,
        result: {
          kind: 'partial' as const,
          stream,
          range: { start: 500, end: 1023, total: 1234 },
          contentType: 'audio/ogg',
        },
      };

      buildAudioHeaders(res, payload);

      expect(res._headers.get('content-range')).toBe('bytes 500-1023/1234');
      expect(res._headers.get('content-length')).toBe(524); // 1023 - 500 + 1
      expect(res._headers.get('content-type')).toBe('audio/ogg');
    });
  });

  describe('buildUnsatisfiableHeaders — 416 empty body', () => {
    it("sets status 416 + Content-Range: bytes */<total> and NO Content-Length or Content-Type (RFC 7233)", () => {
      const res = makeResMock();

      buildUnsatisfiableHeaders(res, 1234);

      expect(res._statusCalls).toEqual([416]);
      expect(res._headers.get('content-range')).toBe('bytes */1234');
      // Empty body by design (Q5) — no Content-Type / Content-Length on 416.
      expect(res._headers.has('content-length')).toBe(false);
      expect(res._headers.has('content-type')).toBe(false);
    });
  });

  describe('narrowing contract — narrows on result.kind, NOT on payload.status', () => {
    // This is a TYPECHECK guarantee, not a runtime one. The test exists to
    // document the R4 Judgment Day fix: TypeScript cannot co-vary `status`
    // with `result.kind`, so the helper MUST narrow on `result.kind`. If a
    // future refactor narrows on `status`, the `.total` / `.range` access
    // stops typechecking — `pnpm exec tsc --noEmit` would fail across this
    // file's `payload: { status: 200 | 206; result: StreamResult }` shape.

    it("compiles when both StreamResult variants are supplied (full + partial)", () => {
      // If narrowing were broken, the type-check on these calls would fail
      // at compile time (this test would not reach `expect`).
      const full: StreamResult = {
        kind: 'full',
        stream: makeStream(),
        total: 10,
        contentType: 'audio/mpeg',
      };
      const partial: StreamResult = {
        kind: 'partial',
        stream: makeStream(),
        range: { start: 0, end: 9, total: 10 },
        contentType: 'audio/mpeg',
      };

      const res1 = makeResMock();
      buildAudioHeaders(res1, { status: 200, result: full });
      const res2 = makeResMock();
      buildAudioHeaders(res2, { status: 206, result: partial });

      expect(res1._headers.get('content-length')).toBe(10);
      expect(res2._headers.get('content-length')).toBe(10); // end - start + 1 = 10
    });
  });
});
