import { NotFoundError } from '../../../shared/errors/not-found-error';
import type { AudioStoragePort } from '../domain/ports/audio-storage.port';
import type { CatalogRepositoryPort } from '../domain/ports/catalog-repo.port';
import type { RangeParserPort } from '../domain/ports/range-parser.port';
import type { StreamResult } from '../domain/types';

/**
 * Outcome of `StreamTrackUseCase.execute` — a discriminated union the
 * controller pattern-matches against to produce the HTTP response.
 *
 * The `'unsatisfiable'` variant is intentionally NOT a `StreamResult` —
 * it carries only the `total` size (drives the 416 Content-Range header of
 * the form `bytes * slash total`, Q5). The `'invalid' | 'multi-range'`
 * variant carries only the literal `reason` (drives the 400
 * `ValidationError` details).
 *
 * `reason` is HARD-CODED to the literal union `'invalid' | 'multi-range'`
 * (C7 fix from Judgment Day): the original conditional
 * `RangeParseResult extends { ok: false } ? RangeParseResult['reason'] : never`
 * is non-distributive over a concrete union and resolves to `never`.
 * `'unsatisfiable'` is excluded here because that variant is the 416
 * branch, never the 400 branch.
 */
export type StreamOutcome =
  | { status: 200 | 206; result: StreamResult }
  | { status: 416; total: number }
  | { status: 400; reason: 'invalid' | 'multi-range' };

/**
 * Driving use case (application layer) — orchestrates the three driven
 * collaborators (`CatalogRepositoryPort`, `AudioStoragePort`,
 * `RangeParserPort`) into one discriminated outcome union.
 *
 * Framework-free by design (REQ-PLAY-002 + REQ-BF-008): only `domain/`
 * + `shared/` imports — NO infrastructure import (enforced by the
 * portfolio test at `architecture.spec.ts:162-181` "forbids application →
 * infrastructure imports"). The concrete `RangeParserPort` /
 * `AudioStoragePort` / `CatalogRepositoryPort` implementations are
 * injected via DI tokens (`RANGE_PARSER_PORT`, `AUDIO_STORAGE_PORT`,
 * `CATALOG_REPOSITORY_PORT`) bound in `PlaybackModule` (PR-2).
 *
 * Every status code the spec enumerates (REQ-PLAY-001 through
 * REQ-PLAY-007) is encoded as a branch of the outcome union:
 *   - 200 (full content)         ← no Range header
 *   - 206 (partial content)      ← satisfiable Range
 *   - 416 (unsatisfiable range)  ← Range beyond file size
 *   - 400 (invalid / multi-range)← malformed or refused multipart
 *   - 404 (track missing)        ← thrown NotFoundError
 */
export class StreamTrackUseCase {
  constructor(
    private readonly catalog: CatalogRepositoryPort,
    private readonly storage: AudioStoragePort,
    private readonly rangeParser: RangeParserPort,
  ) {}

  async execute(trackId: string, rangeHeader: string | undefined): Promise<StreamOutcome> {
    const track = await this.catalog.findTrackById(trackId);
    if (!track) throw new NotFoundError('track', trackId);

    const { size } = await this.storage.stat(track.filePath);
    const parsed = this.rangeParser.parse(size, rangeHeader);

    if (!parsed.ok) {
      if (parsed.reason === 'unsatisfiable') return { status: 416, total: size };
      // C7 fix — the literal union 'invalid' | 'multi-range' is hard-coded
      // in `StreamOutcome`; `'unsatisfiable'` is excluded (it is the 416
      // branch above). TypeScript narrows `parsed.reason` to
      // `'invalid' | 'multi-range'` here because the 'unsatisfiable' arm
      // has already returned.
      return { status: 400, reason: parsed.reason };
    }

    if (parsed.range === null) {
      const stream = this.storage.open(track.filePath, null);
      return { status: 200, result: { kind: 'full', stream, total: size } };
    }

    const stream = this.storage.open(track.filePath, {
      start: parsed.range.start,
      end: parsed.range.end,
    });
    return { status: 206, result: { kind: 'partial', stream, range: parsed.range } };
  }
}
