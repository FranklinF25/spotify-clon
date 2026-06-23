import { Module } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import { GetAlbumUseCase } from '../application/get-album.use-case';
import { GetArtistUseCase } from '../application/get-artist.use-case';
import { GetTrackUseCase } from '../application/get-track.use-case';
import { ListAlbumsUseCase } from '../application/list-albums.use-case';
import { ListArtistsUseCase } from '../application/list-artists.use-case';
import { AuthModule } from '../../identity/infrastructure/auth.module';
import { PrismaModule } from '../../../shared/prisma.module';
import { CatalogController } from './catalog.controller';
import { PrismaCatalogRepository } from './prisma-catalog.repository';

/**
 * Wires the catalog bounded context for the HTTP layer (CAT-PR2b1-06).
 *
 * `PrismaClient` is provided by the GLOBAL `PrismaModule` (single connection
 * pool per process — extracting it in PR-1 avoided pool duplication with
 * `AuthModule`). Importing `PrismaModule` here lets the repository resolve
 * the client without this module re-declaring the factory.
 *
 * `AuthModule` is imported so `CatalogController`'s class-level
 * `@UseGuards(JwtAuthGuard)` can resolve the guard + its `NestJwtSigner`
 * dependency. Auth is a cross-cutting concern; `AuthModule` exports the
 * guard for reuse by other bounded contexts (catalog, future playback).
 *
 * Every provider uses EXPLICIT `useFactory` + `inject` instead of `useClass`
 * shorthand. Reason: under Vitest, esbuild does NOT emit `design:paramtypes`
 * reflect metadata, so NestJS DI resolves constructor params to `undefined`
 * and catalog requests 500 with INTERNAL_ERROR. Identity's `AuthModule`
 * follows the same explicit pattern (per `JwtAuthGuard` comment block —
 * same esbuild caveat). Production runtime (tsc emits metadata) is
 * unaffected, but tests are the portfolio gate, so explicit wins.
 *
 * NO `CATALOG_CONFIG` token (catalog has no env-driven config — R2-CRIT-4
 * dropped every catalog env knob). Identity's `IDENTITY_CONFIG` is
 * load-bearing there because identity has env-driven knobs (DATABASE_URL,
 * JWT secret, argon params); catalog has none.
 *
 * `SearchCatalogUseCase` will join the providers array (same shape:
 * `inject: [PrismaCatalogRepository]`, `useFactory: (repo) => new ...`)
 * when PR-3c lands.
 */
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [CatalogController],
  providers: [
    {
      provide: PrismaCatalogRepository,
      inject: [PrismaClient],
      useFactory: (prisma: PrismaClient) => new PrismaCatalogRepository(prisma),
    },
    {
      provide: ListArtistsUseCase,
      inject: [PrismaCatalogRepository],
      useFactory: (repo: PrismaCatalogRepository) => new ListArtistsUseCase(repo),
    },
    {
      provide: GetArtistUseCase,
      inject: [PrismaCatalogRepository],
      useFactory: (repo: PrismaCatalogRepository) => new GetArtistUseCase(repo),
    },
    {
      provide: ListAlbumsUseCase,
      inject: [PrismaCatalogRepository],
      useFactory: (repo: PrismaCatalogRepository) => new ListAlbumsUseCase(repo),
    },
    {
      provide: GetAlbumUseCase,
      inject: [PrismaCatalogRepository],
      useFactory: (repo: PrismaCatalogRepository) => new GetAlbumUseCase(repo),
    },
    {
      provide: GetTrackUseCase,
      inject: [PrismaCatalogRepository],
      useFactory: (repo: PrismaCatalogRepository) => new GetTrackUseCase(repo),
    },
  ],
})
export class CatalogModule {}
