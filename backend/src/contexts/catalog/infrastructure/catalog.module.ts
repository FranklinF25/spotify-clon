import { Module } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import { GetAlbumUseCase } from '../application/get-album.use-case';
import { GetArtistUseCase } from '../application/get-artist.use-case';
import { GetTrackUseCase } from '../application/get-track.use-case';
import { ListAlbumsUseCase } from '../application/list-albums.use-case';
import { ListArtistsUseCase } from '../application/list-artists.use-case';
import { SearchCatalogUseCase } from '../application/search-catalog.use-case';
import { UploadTrackUseCase } from '../application/upload-track.use-case';
import type { EnvConfig } from '../../../config';
import { ENV_CONFIG } from '../../../config.tokens';
import { AuthModule } from '../../identity/infrastructure/auth.module';
import { PrismaModule } from '../../../shared/prisma.module';
import { AUDIO_FILE_WRITER_PORT, CATALOG_REPOSITORY_PORT } from '../domain/ports/tokens';
import type { AudioFileWriterPort } from '../domain/ports/audio-file-writer.port';
import { CatalogController } from './catalog.controller';
import { FsAudioFileWriter } from './fs-audio-file-writer';
import { PrismaCatalogRepository } from './prisma-catalog.repository';

/**
 * Wires the catalog bounded context for the HTTP layer (CAT-PR2b1-06 +
 * CAT-PR3c-03).
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
 * JWT secret, argon params); catalog has none. The upload path (REQ-UPLOAD-001)
 * reads `AUDIO_STORAGE_PATH` off the GLOBAL `ENV_CONFIG` token (provided by
 * `ConfigModule`, injected by `FsAudioFileWriter`'s factory) — an
 * infrastructure adapter concern, not a catalog env knob, so no dedicated
 * config token is introduced.
 *
 * Cross-context port export (PB-PR2-02 — additive, C3 fix): the module
 * additively binds `{ provide: CATALOG_REPOSITORY_PORT,
 * useExisting: PrismaCatalogRepository }` and exports the token. This is
 * the canonical way consumers (playback's `PlaybackModule`) inject the
 * `CatalogRepositoryPort` contract WITHOUT depending on the concrete
 * `PrismaCatalogRepository` adapter. `useExisting` aliases the existing
 * provider — NO second instance is constructed, NO existing catalog
 * resolution path is altered. Catalog's own use cases keep resolving
 * `PrismaCatalogRepository` by class as before.
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
    // NEW (PB-PR2-02 — additive) — alias the existing PrismaCatalogRepository
    // provider under the CATALOG_REPOSITORY_PORT Symbol token so cross-
    // context consumers can inject the port contract (C3 fix).
    { provide: CATALOG_REPOSITORY_PORT, useExisting: PrismaCatalogRepository },
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
    {
      provide: SearchCatalogUseCase,
      inject: [PrismaCatalogRepository],
      useFactory: (repo: PrismaCatalogRepository) => new SearchCatalogUseCase(repo),
    },
    // NEW (REQ-UPLOAD-001) — audio file writer adapter. Reads
    // AUDIO_STORAGE_PATH off the validated EnvConfig and writes uploads
    // under `<AUDIO_STORAGE_PATH>/audio` (the seeder/streaming root). NOT
    // exported: the writer is catalog-internal, no cross-context consumer.
    {
      provide: AUDIO_FILE_WRITER_PORT,
      useFactory: (config: EnvConfig) => new FsAudioFileWriter(config),
      inject: [ENV_CONFIG],
    },
    // NEW (REQ-UPLOAD-001) — upload driving use case. Injects the CONCRETE
    // repository (catalog-internal convention: catalog's own use cases
    // resolve `PrismaCatalogRepository` by class; only cross-context
    // consumers go through the CATALOG_REPOSITORY_PORT token) plus the
    // writer port. `inject` order MUST match the constructor param order
    // (catalog, writer).
    {
      provide: UploadTrackUseCase,
      inject: [PrismaCatalogRepository, AUDIO_FILE_WRITER_PORT],
      useFactory: (repo: PrismaCatalogRepository, writer: AudioFileWriterPort) =>
        new UploadTrackUseCase(repo, writer),
    },
  ],
  // NEW (PB-PR2-02 — additive) — playback's `PlaybackModule` injects the
  // port token; NestJS only resolves it across module boundaries when the
  // producing module exports the token. Catalog previously had no exports
  // (no other module needed anything from it); this is the first.
  exports: [CATALOG_REPOSITORY_PORT],
})
export class CatalogModule {}
