import { Controller, Get, Headers, Inject, Param, Res, StreamableFile, UseGuards } from '@nestjs/common';
import type { Response } from 'express';

import { ValidationError } from '../../../shared/errors/validation-error';
import { JwtAuthGuard } from '../../identity/infrastructure/auth.guard';
import { StreamTrackUseCase } from '../application/stream-track.use-case';
import { buildAudioHeaders, buildUnsatisfiableHeaders } from './build-audio-response';

/**
 * HTTP adapter for the playback bounded context (PB-PR2-06, REQ-PLAY-005 +
 * REQ-PLAY-007).
 *
 * Routes (under the global `/api/v1` prefix set in `main.ts`):
 *   - GET /tracks/:id/stream → StreamTrackUseCase → 200 / 206 / 416 / 400 / 404
 *
 * `@Controller()` is BARE (NO `'api/v1'` prefix — C4 fix from Judgment Day):
 * `main.ts` already calls `setGlobalPrefix('api/v1')`, so a controller-level
 * prefix would double-mount to `/api/v1/api/v1/tracks/:id/stream`. Mirrors
 * the `CatalogController` pattern.
 *
 * `@UseGuards(JwtAuthGuard)` at class level (Decision #3) — every route is
 * authenticated. An unauthenticated request is rejected with HTTP 401
 * before the route handler runs. Future endpoints inherit the guard by
 * default.
 *
 * `@Res({ passthrough: true })` (Q3) is the only NestJS-sanctioned pattern
 * for setting status + headers AND letting the framework pipe a
 * `StreamableFile` return value. The helper mutates `res`; the controller
 * returns the stream.
 *
 * The 400 branch throws `ValidationError` (C5 fix — `(message, details[])`
 * arity; STATIC `import { ValidationError }` — never a dynamic
 * `await import(...)` inside the throw). The existing global exception
 * filter emits the canonical `VALIDATION_ERROR` envelope.
 *
 * The 416 branch returns an explicitly-empty `StreamableFile(Buffer.alloc(0))`
 * — RFC 7233 §4.4 permits an empty body; the client reads the
 * unsatisfiable-range signal from the `Content-Range` header.
 *
 * `filePath` NEVER appears in any response body or header — the controller
 * pipes the stream bytes only and uses the discriminated-union outcome for
 * all status selection. (REQ-PLAY-005 scenario "filePath never leaks to
 * the client".)
 */
@Controller()
@UseGuards(JwtAuthGuard)
export class PlaybackController {
  // Explicit @Inject(StreamTrackUseCase) — under Vitest, esbuild does NOT
  // emit `design:paramtypes` reflect metadata, so NestJS DI resolves
  // constructor params to `undefined` and the request 500s with
  // INTERNAL_ERROR. Explicit `@Inject()` stores the token under Nest's
  // `self:paramtypes` key, which does not depend on compiler metadata and
  // works under both `tsc` (production) and esbuild (tests). Mirrors the
  // CatalogController pattern.
  constructor(@Inject(StreamTrackUseCase) private readonly streamTrack: StreamTrackUseCase) {}

  @Get('tracks/:id/stream')
  async stream(
    @Param('id') id: string,
    @Headers('range') range: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const outcome = await this.streamTrack.execute(id, range);

    // 416 unsatisfiable — empty body, signal in Content-Range header.
    if (outcome.status === 416) {
      buildUnsatisfiableHeaders(res, outcome.total);
      return new StreamableFile(Buffer.alloc(0));
    }

    // 400 invalid / multi-range — re-use the shared ValidationError so the
    // global exception filter emits the canonical VALIDATION_ERROR envelope.
    // The details array carries the field-level reason so clients can map
    // the rejection back to the `Range` header.
    if (outcome.status === 400) {
      throw new ValidationError(`Invalid Range header: ${outcome.reason}`, [
        { field: 'Range', issue: outcome.reason },
      ]);
    }

    // 200 (kind 'full') OR 206 (kind 'partial') — the helper narrows on
    // `result.kind` to compute Content-Length / Content-Range correctly.
    buildAudioHeaders(res, outcome);

    // No `as any` cast — `outcome.result.stream` is already a Readable
    // (AudioStream = Readable), which StreamableFile accepts directly
    // (W-audiostream). Nest pipes the bytes to the client.
    return new StreamableFile(outcome.result.stream);
  }
}
