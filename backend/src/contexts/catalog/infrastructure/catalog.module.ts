import { Module } from '@nestjs/common';

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
 * `PrismaCatalogRepository` is bound via `useClass` so NestJS instantiates it
 * with `PrismaClient` injected through its constructor — plain class, no
 * `@Injectable`, mirrors `PrismaUserRepository`.
 *
 * The 5 use cases use NestJS shorthand provider syntax — Nest resolves
 * constructor dependencies by class metadata. The use cases depend on the
 * concrete `PrismaCatalogRepository` class token (NOT a separate port token),
 * which is exactly what the useClass provider above exposes.
 *
 * NO `CATALOG_CONFIG` token (catalog has no env-driven config — R2-CRIT-4
 * dropped every catalog env knob). Identity's `IDENTITY_CONFIG` is
 * load-bearing there because identity has env-driven knobs (DATABASE_URL,
 * JWT secret, argon params); catalog has none.
 *
 * `SearchCatalogUseCase` will join the providers array when PR-3c lands.
 */
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [CatalogController],
  providers: [
    { provide: PrismaCatalogRepository, useClass: PrismaCatalogRepository },
    ListArtistsUseCase,
    GetArtistUseCase,
    ListAlbumsUseCase,
    GetAlbumUseCase,
    GetTrackUseCase,
  ],
})
export class CatalogModule {}
