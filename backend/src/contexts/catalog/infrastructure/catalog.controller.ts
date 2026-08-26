import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { memoryStorage } from 'multer';

import { GetAlbumUseCase } from '../application/get-album.use-case';
import { GetArtistUseCase } from '../application/get-artist.use-case';
import { GetTrackUseCase } from '../application/get-track.use-case';
import { ListAlbumsUseCase } from '../application/list-albums.use-case';
import { ListArtistsUseCase } from '../application/list-artists.use-case';
import { SearchCatalogUseCase } from '../application/search-catalog.use-case';
import { UploadTrackUseCase } from '../application/upload-track.use-case';
import { JwtAuthGuard } from '../../identity/infrastructure/auth.guard';
import { AUDIO_EXTENSIONS, isAudioFile } from '../../../shared/audio-meta';
import { ValidationError } from '../../../shared/errors/validation-error';
import { validatePagination } from './dto/validate-pagination';
import { validateSearch } from './dto/validate-search';
import { UploadFileExceptionFilter } from './upload-file-exception.filter';

/**
 * Upload size cap (REQ-UPLOAD-003): 150 MB — headroom above the largest
 * realistic lossless single track (a ~1h FLAC sits around 300–400 MB only
 * at extreme bit depths; typical album-length FLAC files stay well under
 * 150 MB). Enforced by multer's `limits.fileSize`, which aborts the stream
 * mid-upload with `LIMIT_FILE_SIZE` → mapped to 400 VALIDATION_ERROR by
 * `UploadFileExceptionFilter`.
 */
export const MAX_UPLOAD_BYTES = 150 * 1024 * 1024;

/**
 * Multer options for `POST /tracks/upload` (REQ-UPLOAD-003).
 *
 *  - `storage: memoryStorage()` — the whole file rides in `file.buffer`; no
 *    temp-file cleanup, and the use case parses tags from the bytes before
 *    the driven writer persists them at the DERIVED path (multer's disk
 *    storage would have already committed the file under a client-chosen
 *    name — the exact thing the sanitizer exists to prevent).
 *  - `limits.fileSize` — the only hard cap. Multer counts streamed bytes,
 *    so an oversized upload is cut off mid-flight, never buffered fully.
 *  - `fileFilter` — extension allowlist via the SAME `isAudioFile` helper
 *    the seeder uses (`AUDIO_EXTENSIONS`), compared case-insensitively on
 *    the original filename. Rejections throw `ValidationError` (NOT
 *    `callback(null, false)` — the silent-drop form would surface as the
 *    generic "no file" error instead of naming the problem). Multer
 *    propagates fileFilter errors through to the Nest exception layer,
 *    where the global filter emits the canonical envelope.
 */
export const UPLOAD_FILE_OPTIONS: MulterOptions = {
  storage: memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (_req, file, callback) => {
    if (!isAudioFile(file.originalname)) {
      callback(
        new ValidationError('Uploaded file has an unsupported extension', [
          {
            field: 'file',
            issue: `filename extension must be one of ${(AUDIO_EXTENSIONS as readonly string[]).join(', ')}`,
          },
        ]),
        false,
      );
      return;
    }
    callback(null, true);
  },
};

/**
 * HTTP adapter for the catalog bounded context (CAT-PR2b1-05 + CAT-PR3c-03
 * + REQ-UPLOAD-001).
 *
 * Routes (under the global `/api/v1` prefix set in `main.ts`):
 *   - GET /artists         → ListArtistsUseCase
 *   - GET /artists/:id     → GetArtistUseCase
 *   - GET /albums          → ListAlbumsUseCase
 *   - GET /albums/:id      → GetAlbumUseCase  (embeds tracks + artist)
 *   - GET /tracks/:id      → GetTrackUseCase  (NO `filePath`)
 *   - GET /search          → SearchCatalogUseCase (grouped tsvector search)
 *   - POST /tracks/upload  → UploadTrackUseCase (multipart, field "file")
 *
 * `@UseGuards(JwtAuthGuard)` at class level — every route inherits the
 * JWT Bearer check (spec R1: 401 without/with invalid token). The guard is
 * owned by identity and reused here rather than duplicated (single source
 * of JWT verification).
 *
 * The list endpoints call `validatePagination` (the wrapper), NOT raw
 * `validate()` — the wrapper re-throws Zod issues as `InvalidPaginationError`
 * (code `INVALID_PAGINATION`) so the spec-pinned token reaches the client
 * (R3-W-3). The search endpoint mirrors the pattern with `validateSearch`
 * → `InvalidQueryError` (code `INVALID_QUERY`).
 *
 * `filePath` is NEVER in any response: `GetTrackUseCase` returns the entity
 * but the controller calls `.toPrimitive()` which omits it; `search` returns
 * `TrackSummary` (NOT the raw `Track` entity), so `filePath` is structurally
 * absent (R4 + R6 guards). The upload response (`UploadTrackResult`) is
 * built from derived ids/meta and contains no path either.
 *
 * Injected property names use the `*UseCase` suffix (mirrors AuthController)
 * so they do not collide with the route-handler method names.
 */
@Controller()
@UseGuards(JwtAuthGuard)
export class CatalogController {
  constructor(
    @Inject(ListArtistsUseCase) private readonly listArtistsUseCase: ListArtistsUseCase,
    @Inject(GetArtistUseCase) private readonly getArtistUseCase: GetArtistUseCase,
    @Inject(ListAlbumsUseCase) private readonly listAlbumsUseCase: ListAlbumsUseCase,
    @Inject(GetAlbumUseCase) private readonly getAlbumUseCase: GetAlbumUseCase,
    @Inject(GetTrackUseCase) private readonly getTrackUseCase: GetTrackUseCase,
    @Inject(SearchCatalogUseCase) private readonly searchUseCase: SearchCatalogUseCase,
    @Inject(UploadTrackUseCase) private readonly uploadTrackUseCase: UploadTrackUseCase,
  ) {}

  @Get('artists')
  async listArtists(@Query() raw: unknown) {
    const query = validatePagination(raw);
    return this.listArtistsUseCase.execute(query);
  }

  @Get('artists/:id')
  async artist(@Param('id') id: string) {
    const { artist, albums } = await this.getArtistUseCase.execute({ id });
    return { ...artist.toPrimitive(), albums };
  }

  @Get('albums')
  async listAlbums(@Query() raw: unknown) {
    const query = validatePagination(raw);
    return this.listAlbumsUseCase.execute(query);
  }

  @Get('albums/:id')
  async album(@Param('id') id: string) {
    const { album, artist, tracks } = await this.getAlbumUseCase.execute({ id });
    return {
      ...album.toPrimitive(),
      artist,
      tracks: tracks.map((t) => t.toPrimitive()),
    };
  }

  @Get('tracks/:id')
  async track(@Param('id') id: string) {
    const track = await this.getTrackUseCase.execute({ id });
    // GetTrackUseCase returns the entity; .toPrimitive() drops `filePath`
    // (internal storage detail, R4 guard).
    return track.toPrimitive();
  }

  @Get('search')
  async search(@Query() raw: unknown) {
    // Wrapper, NOT raw validate() — re-throws Zod issues as
    // `InvalidQueryError` so the spec-pinned `INVALID_QUERY` token reaches
    // the client on empty/missing `q` (R3-W-3 lesson applied to R6).
    const dto = validateSearch(raw);
    // SearchResult already uses summaries (no raw entities, no `filePath`),
    // so it is safe to return directly.
    return this.searchUseCase.execute(dto);
  }

  /**
   * POST /tracks/upload (REQ-UPLOAD-001) — multipart `file` part in, 201
   * upload contract out (`{ track, artist, album }`, no `filePath`).
   *
   * Validation ladder (every rung a 400 VALIDATION_ERROR with `details`
   * on field `file` — REQ-UPLOAD-003):
   *   1. `UPLOAD_FILE_OPTIONS.fileFilter` — extension allowlist (runs
   *      inside the interceptor, BEFORE this handler).
   *   2. the missing-file check below — a request without a `file` part
   *      (or a non-multipart body: the interceptor skips parsing and
   *      `file` stays undefined).
   *   3. `UploadFileExceptionFilter` — maps multer's `LIMIT_FILE_SIZE`
   *      (and any other `MulterError`) onto the same envelope.
   *   4. `UploadTrackUseCase` — filename sanitization / traversal
   *      rejection on the ORIGINAL client filename.
   *
   * `@HttpCode(201)` — POST defaults to 201 in Nest, but pinning it keeps
   * the contract explicit against a future `HttpCode` default flip; the
   * idempotent re-upload case (same derived path → overwrite) still
   * returns 201 by design (the resource is created-or-updated, and 200 vs
   * 201 on overwrite would leak storage semantics into the contract).
   */
  @Post('tracks/upload')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file', UPLOAD_FILE_OPTIONS))
  @UseFilters(UploadFileExceptionFilter)
  async upload(@UploadedFile() file?: Express.Multer.File) {
    if (!file || !file.buffer) {
      throw new ValidationError('No file was uploaded', [
        {
          field: 'file',
          issue: 'a multipart/form-data body with a "file" part is required',
        },
      ]);
    }
    return this.uploadTrackUseCase.execute({
      originalFilename: file.originalname,
      bytes: file.buffer,
    });
  }
}
