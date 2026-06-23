import { Controller, Get, Inject, Param, Query, UseGuards } from '@nestjs/common';

import { GetAlbumUseCase } from '../application/get-album.use-case';
import { GetArtistUseCase } from '../application/get-artist.use-case';
import { GetTrackUseCase } from '../application/get-track.use-case';
import { ListAlbumsUseCase } from '../application/list-albums.use-case';
import { ListArtistsUseCase } from '../application/list-artists.use-case';
import { SearchCatalogUseCase } from '../application/search-catalog.use-case';
import { JwtAuthGuard } from '../../identity/infrastructure/auth.guard';
import { validatePagination } from './dto/validate-pagination';
import { validateSearch } from './dto/validate-search';

/**
 * HTTP adapter for the catalog bounded context (CAT-PR2b1-05 + CAT-PR3c-03).
 *
 * Routes (under the global `/api/v1` prefix set in `main.ts`):
 *   - GET /artists         → ListArtistsUseCase
 *   - GET /artists/:id     → GetArtistUseCase
 *   - GET /albums          → ListAlbumsUseCase
 *   - GET /albums/:id      → GetAlbumUseCase  (embeds tracks + artist)
 *   - GET /tracks/:id      → GetTrackUseCase  (NO `filePath`)
 *   - GET /search          → SearchCatalogUseCase (grouped tsvector search)
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
 * absent (R4 + R6 guards).
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
}
