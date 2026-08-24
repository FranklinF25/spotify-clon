import { Module } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import { CATALOG_REPOSITORY_PORT } from '../../catalog/domain/ports/tokens';
import type { CatalogRepositoryPort } from '../../catalog/domain/ports/catalog-repository.port';
import { CatalogModule } from '../../catalog/infrastructure/catalog.module';
import { AuthModule } from '../../identity/infrastructure/auth.module';
import { AppLogger } from '../../../logger';
import { PrismaModule } from '../../../shared/prisma.module';
import { AddAlbumToLibraryUseCase } from '../application/add-album-to-library.use-case';
import type { LibraryLoggerPort } from '../application/list-library.use-case';
import { ListLibraryUseCase } from '../application/list-library.use-case';
import { RemoveAlbumFromLibraryUseCase } from '../application/remove-album-from-library.use-case';
import { LIBRARY_REPOSITORY_PORT } from '../domain/ports/tokens';
import type { LibraryRepositoryPort } from '../domain/ports/library-repository.port';
import { LibraryController } from './library.controller';
import { PrismaLibraryRepository } from './prisma-library.repository';

/**
 * Wires the library bounded context for the HTTP layer (F6 — design §7).
 *
 * Line-by-line mirror of `PlaylistsModule`:
 *  - `useFactory` + explicit `inject` everywhere, NEVER `useClass` (the
 *    esbuild/Vitest reflect-metadata caveat documented in
 *    `catalog.module.ts:30-41`);
 *  - the concrete adapter is aliased under the Symbol token via
 *    `useExisting` so use cases depend on the PORT contract;
 *  - `AppLogger` is provided per-module (the root provider is not `@Global`;
 *    stateless, so a per-module instance is safe);
 *  - the port token is exported (future-proofing mirror of F5 — a future
 *    context reads saved albums through the contract, never the adapter).
 *
 * `CatalogModule` import resolves `CATALOG_REPOSITORY_PORT` (hydration for
 * ListLibrary + existence validation for AddAlbum); `AuthModule` provides
 * `JwtAuthGuard`. REQ-L-007: nothing from `playlists` is imported here —
 * the unified view is composed client-side (enforced by the arch scan).
 */
@Module({
  imports: [PrismaModule, AuthModule, CatalogModule],
  controllers: [LibraryController],
  providers: [
    {
      provide: PrismaLibraryRepository,
      inject: [PrismaClient],
      useFactory: (prisma: PrismaClient) => new PrismaLibraryRepository(prisma),
    },
    // Alias under the Symbol token so use cases depend on the PORT contract.
    { provide: LIBRARY_REPOSITORY_PORT, useExisting: PrismaLibraryRepository },
    {
      provide: AppLogger,
      useFactory: () => new AppLogger(),
    },
    {
      provide: AddAlbumToLibraryUseCase,
      inject: [LIBRARY_REPOSITORY_PORT, CATALOG_REPOSITORY_PORT],
      useFactory: (repo: LibraryRepositoryPort, catalog: CatalogRepositoryPort) =>
        new AddAlbumToLibraryUseCase(repo, catalog),
    },
    {
      provide: RemoveAlbumFromLibraryUseCase,
      inject: [LIBRARY_REPOSITORY_PORT],
      useFactory: (repo: LibraryRepositoryPort) => new RemoveAlbumFromLibraryUseCase(repo),
    },
    {
      provide: ListLibraryUseCase,
      inject: [LIBRARY_REPOSITORY_PORT, CATALOG_REPOSITORY_PORT, AppLogger],
      useFactory: (
        repo: LibraryRepositoryPort,
        catalog: CatalogRepositoryPort,
        logger: LibraryLoggerPort,
      ) => new ListLibraryUseCase(repo, catalog, logger),
    },
  ],
  exports: [LIBRARY_REPOSITORY_PORT],
})
export class LibraryModule {}
