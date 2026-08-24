import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard, type RequestWithUser } from '../../identity/infrastructure/auth.guard';
import { AddAlbumToLibraryUseCase } from '../application/add-album-to-library.use-case';
import { ListLibraryUseCase } from '../application/list-library.use-case';
import { RemoveAlbumFromLibraryUseCase } from '../application/remove-album-from-library.use-case';
import { parseAlbumIdParam } from './dto/album-id.param';

/**
 * HTTP adapter for the library bounded context (F6 — design §8,
 * REQ-L-001..004).
 *
 * Routes (under the global `/api/v1` prefix set in `main.ts`):
 *   - GET    /library/albums          → ListLibraryUseCase    (200, bare SavedAlbum[] — D5)
 *   - POST   /library/albums/:albumId → AddAlbumToLibraryUseCase    (204 — @HttpCode)
 *   - DELETE /library/albums/:albumId → RemoveAlbumFromLibraryUseCase (204)
 *
 * `@Controller()` is BARE — `main.ts` already calls
 * `setGlobalPrefix('api/v1')`, so a controller-level prefix would
 * double-mount (mirrors PlaylistsController + CatalogController).
 *
 * `@UseGuards(JwtAuthGuard)` at class level (REQ-L-001) — every route
 * inherits the JWT Bearer check; unauthenticated → 401 before the handler.
 *
 * F5 locked pattern: every handler does `@Req() req: RequestWithUser` and
 * reads `userId = req.user!.sub` INLINE — no `@CurrentUser()` decorator.
 * Ownership always comes from the JWT, never the payload.
 *
 * `@HttpCode(204)` is load-bearing on both mutations: NestJS defaults POST
 * to 201, but upsert/remove are 204-no-body per REQ-L-002/004. The DELETE
 * decorator is redundant-but-explicit (NestJS already defaults 204) — kept
 * for symmetry with the POST and self-documentation.
 *
 * `parseAlbumIdParam` runs on BOTH param handlers (design D6): one uniform
 * UUID guard at one seam; malformed → 422 (REQ-L-002), while well-formed
 * unknown ids are the use case's 422 (add) or silent idempotent 204
 * (remove, REQ-L-004).
 *
 * Explicit `@Inject(<UseCase>)` on every constructor param — under Vitest,
 * esbuild does NOT emit `design:paramtypes` reflect metadata, so NestJS DI
 * resolves params to `undefined` and requests 500 (mirrors
 * PlaylistsController).
 */
@Controller()
@UseGuards(JwtAuthGuard)
export class LibraryController {
  constructor(
    @Inject(AddAlbumToLibraryUseCase)
    private readonly addUseCase: AddAlbumToLibraryUseCase,
    @Inject(RemoveAlbumFromLibraryUseCase)
    private readonly removeUseCase: RemoveAlbumFromLibraryUseCase,
    @Inject(ListLibraryUseCase) private readonly listUseCase: ListLibraryUseCase,
  ) {}

  @Get('library/albums')
  async list(@Req() req: RequestWithUser) {
    // Bare SavedAlbum[] (design D5 — mirrors GET /playlists' bare array);
    // `addedAt` serializes to ISO via JSON.
    return this.listUseCase.execute({ userId: req.user!.sub });
  }

  @Post('library/albums/:albumId')
  @HttpCode(204)
  async add(@Param('albumId') albumId: string, @Req() req: RequestWithUser): Promise<void> {
    const parsed = parseAlbumIdParam(albumId);
    await this.addUseCase.execute({
      userId: req.user!.sub,
      albumId: parsed,
      now: new Date(),
    });
  }

  @Delete('library/albums/:albumId')
  @HttpCode(204)
  async remove(@Param('albumId') albumId: string, @Req() req: RequestWithUser): Promise<void> {
    const parsed = parseAlbumIdParam(albumId);
    await this.removeUseCase.execute({ userId: req.user!.sub, albumId: parsed });
  }
}
