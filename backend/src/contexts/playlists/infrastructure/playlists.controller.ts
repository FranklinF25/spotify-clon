import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';

import { NotFoundError } from '../../../shared/errors/not-found-error';
import { JwtAuthGuard, type RequestWithUser } from '../../identity/infrastructure/auth.guard';
import { AddTrackToPlaylistUseCase } from '../application/add-track-to-playlist.use-case';
import { CreatePlaylistUseCase } from '../application/create-playlist.use-case';
import { DeletePlaylistUseCase } from '../application/delete-playlist.use-case';
import { GetPlaylistUseCase } from '../application/get-playlist.use-case';
import { ListOwnPlaylistsUseCase } from '../application/list-own-playlists.use-case';
import { ListPlaylistTracksUseCase } from '../application/list-playlist-tracks.use-case';
import { RemoveTrackFromPlaylistUseCase } from '../application/remove-track-from-playlist.use-case';
import { ReorderPlaylistUseCase } from '../application/reorder-playlist.use-case';
import { RenamePlaylistUseCase } from '../application/rename-playlist.use-case';
import { parseAddTrackBody } from './dto/add-track.dto';
import { parseCreatePlaylistBody } from './dto/create-playlist.dto';
import { parseReorderBody } from './dto/reorder.dto';
import { parseRenamePlaylistBody } from './dto/rename-playlist.dto';

/**
 * HTTP adapter for the playlists bounded context (F5 — design §11,
 * REQ-P-001..011).
 *
 * Routes (under the global `/api/v1` prefix set in `main.ts`):
 *   - POST   /playlists                  → CreatePlaylistUseCase   (201)
 *   - GET    /playlists                  → ListOwnPlaylistsUseCase (200)
 *   - GET    /playlists/:id              → GetPlaylistUseCase      (200, OPEN READ)
 *   - PATCH  /playlists/:id              → RenamePlaylistUseCase   (200)
 *   - DELETE /playlists/:id              → DeletePlaylistUseCase   (204)
 *   - POST   /playlists/:id/tracks       → AddTrackToPlaylistUseCase    (201)
 *   - GET    /playlists/:id/tracks       → ListPlaylistTracksUseCase   (200, OPEN READ)
 *   - DELETE /playlists/:id/tracks/:pos  → RemoveTrackFromPlaylistUseCase (204)
 *   - POST   /playlists/:id/reorder      → ReorderPlaylistUseCase       (200)
 *
 * `@Controller()` is BARE — `main.ts` already calls `setGlobalPrefix('api/v1')`,
 * so a controller-level `api/v1` prefix would double-mount (C4 fix, mirrors
 * CatalogController + PlaybackController). Each route carries its own
 * `playlists` resource segment (mirrors AuthController's `auth/` convention).
 *
 * `@UseGuards(JwtAuthGuard)` at class level (REQ-P-001) — every route inherits
 * the JWT Bearer check. An unauthenticated request is rejected with 401 before
 * the handler runs.
 *
 * LOCKED technical #6: every mutation handler does `@Req() req:
 * RequestWithUser` then reads `ownerId = req.user!.sub` INLINE. F5 does NOT
 * introduce a `@CurrentUser()` decorator — the inline pattern is the locked
 * convention (mirrors AuthController's `GET /me`).
 *
 * Ownership composition (REQ-P-011): mutation use cases call
 * `loadOwnedPlaylist`, which checks existence FIRST (404) then ownership (403).
 * NotFoundError precedence over ForbiddenError is structural — the controller
 * cannot reverse it because the helper composes them in order. Reads (`GET
 * /:id`, `GET /:id/tracks`) skip the helper and NEVER check ownership
 * (REQ-P-004 / REQ-P-008 open read).
 *
 * Explicit `@Inject(<UseCase>)` on every constructor param — under Vitest,
 * esbuild does NOT emit `design:paramtypes` reflect metadata, so NestJS DI
 * resolves params to `undefined` and requests 500. Mirrors CatalogController.
 */
@Controller()
@UseGuards(JwtAuthGuard)
export class PlaylistsController {
  constructor(
    @Inject(CreatePlaylistUseCase) private readonly createUseCase: CreatePlaylistUseCase,
    @Inject(ListOwnPlaylistsUseCase) private readonly listOwnUseCase: ListOwnPlaylistsUseCase,
    @Inject(GetPlaylistUseCase) private readonly getUseCase: GetPlaylistUseCase,
    @Inject(RenamePlaylistUseCase) private readonly renameUseCase: RenamePlaylistUseCase,
    @Inject(DeletePlaylistUseCase) private readonly deleteUseCase: DeletePlaylistUseCase,
    @Inject(AddTrackToPlaylistUseCase) private readonly addTrackUseCase: AddTrackToPlaylistUseCase,
    @Inject(ListPlaylistTracksUseCase) private readonly listTracksUseCase: ListPlaylistTracksUseCase,
    @Inject(RemoveTrackFromPlaylistUseCase)
    private readonly removeTrackUseCase: RemoveTrackFromPlaylistUseCase,
    @Inject(ReorderPlaylistUseCase) private readonly reorderUseCase: ReorderPlaylistUseCase,
  ) {}

  @Post('playlists')
  async create(@Body() body: unknown, @Req() req: RequestWithUser) {
    const dto = parseCreatePlaylistBody(body);
    return this.createUseCase.execute({
      title: dto.title,
      ownerId: req.user!.sub,
      now: new Date(),
    });
  }

  @Get('playlists')
  async list(@Req() req: RequestWithUser) {
    return this.listOwnUseCase.execute({ ownerId: req.user!.sub });
  }

  @Get('playlists/:id')
  async detail(@Param('id') id: string) {
    // Open read (REQ-P-004) — NO ownerId; the use case signature carries none.
    return this.getUseCase.execute({ id });
  }

  @Patch('playlists/:id')
  async rename(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: RequestWithUser,
  ) {
    const dto = parseRenamePlaylistBody(body);
    return this.renameUseCase.execute({
      id,
      ownerId: req.user!.sub,
      newTitle: dto.title,
      now: new Date(),
    });
  }

  @Delete('playlists/:id')
  @HttpCode(204)
  async delete(@Param('id') id: string, @Req() req: RequestWithUser): Promise<void> {
    await this.deleteUseCase.execute({ id, ownerId: req.user!.sub });
  }

  @Post('playlists/:id/tracks')
  async addTrack(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: RequestWithUser,
  ) {
    const dto = parseAddTrackBody(body);
    return this.addTrackUseCase.execute({
      id,
      ownerId: req.user!.sub,
      trackId: dto.trackId,
      now: new Date(),
    });
  }

  @Get('playlists/:id/tracks')
  async tracks(@Param('id') id: string) {
    // Open read (REQ-P-008) — NO ownerId; hydration + silent-omit live in the
    // use case. Returns hydrated TrackPrimitive[] ready for playFromList.
    return this.listTracksUseCase.execute({ id });
  }

  @Delete('playlists/:id/tracks/:position')
  @HttpCode(204)
  async removeTrack(
    @Param('id') id: string,
    @Param('position') position: string,
    @Req() req: RequestWithUser,
  ): Promise<void> {
    // NestJS delivers path params as strings. A non-positive-integer segment
    // can never reference a real row → surface as NotFoundError (404), the
    // same code the use case uses for out-of-range integer positions
    // (REQ-P-009 "Non-existent position returns 404").
    const parsed = Number(position);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new NotFoundError('playlist track', `${id}#${position}`);
    }
    await this.removeTrackUseCase.execute({
      id,
      ownerId: req.user!.sub,
      position: parsed,
    });
  }

  @Post('playlists/:id/reorder')
  async reorder(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: RequestWithUser,
  ) {
    const dto = parseReorderBody(body);
    return this.reorderUseCase.execute({
      id,
      ownerId: req.user!.sub,
      from: dto.from,
      to: dto.to,
    });
  }
}
