import { Module } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import { CatalogModule } from '../../catalog/infrastructure/catalog.module';
import { CATALOG_REPOSITORY_PORT } from '../../catalog/domain/ports/tokens';
import type { CatalogRepositoryPort } from '../../catalog/domain/ports/catalog-repository.port';
import { AuthModule } from '../../identity/infrastructure/auth.module';
import { AppLogger } from '../../../logger';
import { PrismaModule } from '../../../shared/prisma.module';
import { AddTrackToPlaylistUseCase } from '../application/add-track-to-playlist.use-case';
import { CreatePlaylistUseCase } from '../application/create-playlist.use-case';
import { DeletePlaylistUseCase } from '../application/delete-playlist.use-case';
import { GetPlaylistUseCase } from '../application/get-playlist.use-case';
import { ListOwnPlaylistsUseCase } from '../application/list-own-playlists.use-case';
import type { PlaylistLoggerPort } from '../application/list-playlist-tracks.use-case';
import { ListPlaylistTracksUseCase } from '../application/list-playlist-tracks.use-case';
import { RemoveTrackFromPlaylistUseCase } from '../application/remove-track-from-playlist.use-case';
import { ReorderPlaylistUseCase } from '../application/reorder-playlist.use-case';
import { RenamePlaylistUseCase } from '../application/rename-playlist.use-case';
import { PLAYLISTS_REPOSITORY_PORT } from '../domain/ports/tokens';
import type { PlaylistsRepositoryPort } from '../domain/ports/playlists-repository.port';
import { PlaylistsController } from './playlists.controller';
import { PrismaPlaylistsRepository } from './prisma-playlists.repository';

/**
 * Wires the playlists bounded context for the HTTP layer (F5 — design §10,
 * REQ-P-013).
 *
 * Imports:
 *  - `PrismaModule` (global) — single Prisma connection pool per process.
 *  - `AuthModule` — provides `JwtAuthGuard` + `NestJwtSigner` so the
 *    controller's class-level guard resolves.
 *  - `CatalogModule` — exports `CATALOG_REPOSITORY_PORT` (PB-PR2-02 additive
 *    export) so playlists injects the PORT CONTRACT for hydration, NEVER the
 *    concrete `PrismaCatalogRepository` (R-app-3 / cross-context lint rule).
 *
 * Every provider uses EXPLICIT `useFactory` + `inject` (NEVER `useClass`
 * shorthand — matches the catalog + identity + playback pattern and sidesteps
 * the esbuild/Vitest reflect-metadata caveat where constructor params resolve
 * to `undefined`). `useExisting` aliases the existing PrismaPlaylistsRepository
 * provider under the PLAYLISTS_REPOSITORY_PORT Symbol token (NO second
 * instance is constructed — mirrors catalog's CATALOG_REPOSITORY_PORT binding).
 *
 * Additively binds + exports PLAYLISTS_REPOSITORY_PORT (mirrors catalog's
 * PB-PR2-02 additive export; future-proofs a future context wanting to read
 * playlists through the port contract).
 *
 * AppLogger: the playlists context is the FIRST feature module to need a
 * logger (the silent-omit warn in ListPlaylistTracksUseCase — design §13).
 * AppLogger is currently provided by the root AppModule (NOT @Global), so this
 * module provides its own instance via useFactory and injects it into the
 * ListPlaylistTracksUseCase factory. AppLogger is stateless (wraps pino), so a
 * per-module instance is harmless. Future hardening: promote AppLogger to a
 * @Global LoggerModule when a second feature-module consumer appears.
 */
@Module({
  imports: [PrismaModule, AuthModule, CatalogModule],
  controllers: [PlaylistsController],
  providers: [
    // Concrete adapter — constructed once, aliased under the port token below.
    {
      provide: PrismaPlaylistsRepository,
      inject: [PrismaClient],
      useFactory: (prisma: PrismaClient) => new PrismaPlaylistsRepository(prisma),
    },
    // Alias the existing provider under the Symbol token so use cases inject
    // the PORT CONTRACT (R-app-3 / REQ-P-013). useExisting constructs NO
    // second instance.
    { provide: PLAYLISTS_REPOSITORY_PORT, useExisting: PrismaPlaylistsRepository },

    // Feature-module-scoped logger (see class doc — AppLogger is not yet
    // @Global; stateless, so a per-module instance is safe).
    {
      provide: AppLogger,
      useFactory: () => new AppLogger(),
    },

    // Use cases — each factory's `inject` order MUST match the use case's
    // constructor param order. Single-port use cases take the playlists port;
    // the two cross-context use cases additionally take CATALOG_REPOSITORY_PORT;
    // ListPlaylistTracksUseCase also takes the logger (PlaylistLoggerPort).
    {
      provide: CreatePlaylistUseCase,
      inject: [PLAYLISTS_REPOSITORY_PORT],
      useFactory: (repo: PlaylistsRepositoryPort) => new CreatePlaylistUseCase(repo),
    },
    {
      provide: ListOwnPlaylistsUseCase,
      inject: [PLAYLISTS_REPOSITORY_PORT],
      useFactory: (repo: PlaylistsRepositoryPort) => new ListOwnPlaylistsUseCase(repo),
    },
    {
      provide: GetPlaylistUseCase,
      inject: [PLAYLISTS_REPOSITORY_PORT],
      useFactory: (repo: PlaylistsRepositoryPort) => new GetPlaylistUseCase(repo),
    },
    {
      provide: RenamePlaylistUseCase,
      inject: [PLAYLISTS_REPOSITORY_PORT],
      useFactory: (repo: PlaylistsRepositoryPort) => new RenamePlaylistUseCase(repo),
    },
    {
      provide: DeletePlaylistUseCase,
      inject: [PLAYLISTS_REPOSITORY_PORT],
      useFactory: (repo: PlaylistsRepositoryPort) => new DeletePlaylistUseCase(repo),
    },
    {
      provide: AddTrackToPlaylistUseCase,
      inject: [PLAYLISTS_REPOSITORY_PORT, CATALOG_REPOSITORY_PORT],
      useFactory: (repo: PlaylistsRepositoryPort, catalog: CatalogRepositoryPort) =>
        new AddTrackToPlaylistUseCase(repo, catalog),
    },
    {
      provide: ListPlaylistTracksUseCase,
      inject: [PLAYLISTS_REPOSITORY_PORT, CATALOG_REPOSITORY_PORT, AppLogger],
      useFactory: (
        repo: PlaylistsRepositoryPort,
        catalog: CatalogRepositoryPort,
        logger: PlaylistLoggerPort,
      ) => new ListPlaylistTracksUseCase(repo, catalog, logger),
    },
    {
      provide: RemoveTrackFromPlaylistUseCase,
      inject: [PLAYLISTS_REPOSITORY_PORT],
      useFactory: (repo: PlaylistsRepositoryPort) => new RemoveTrackFromPlaylistUseCase(repo),
    },
    {
      provide: ReorderPlaylistUseCase,
      inject: [PLAYLISTS_REPOSITORY_PORT],
      useFactory: (repo: PlaylistsRepositoryPort) => new ReorderPlaylistUseCase(repo),
    },
  ],
  // REQ-P-013 — export the port token so a future context can read playlists
  // through the contract without depending on the concrete adapter.
  exports: [PLAYLISTS_REPOSITORY_PORT],
})
export class PlaylistsModule {}
