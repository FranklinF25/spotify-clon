import { Module } from '@nestjs/common';

import { CatalogModule } from '../../catalog/infrastructure/catalog.module';
import { CATALOG_REPOSITORY_PORT } from '../../catalog/domain/ports/tokens';
import type { CatalogRepositoryPort } from '../../catalog/domain/ports/catalog-repository.port';
import type { EnvConfig } from '../../../config';
import { ENV_CONFIG } from '../../../config.tokens';
import { AuthModule } from '../../identity/infrastructure/auth.module';
import { PrismaModule } from '../../../shared/prisma.module';
import { StreamTrackUseCase } from '../application/stream-track.use-case';
import type { AudioStoragePort } from '../domain/ports/audio-storage.port';
import type { RangeParserPort } from '../domain/ports/range-parser.port';
import { AUDIO_STORAGE_PORT, RANGE_PARSER_PORT } from '../domain/ports/tokens';
import { FsAudioStorage } from './fs-audio-storage';
import { PlaybackController } from './playback.controller';
import { RangeParserAdapter } from './range-parser.adapter';

/**
 * Wires the playback bounded context for the HTTP layer (PB-PR2-07,
 * REQ-PLAY-006).
 *
 * Imports:
 *  - `PrismaModule` (global) — single Prisma connection pool per process.
 *  - `AuthModule` — provides `JwtAuthGuard` + `NestJwtSigner` so the
 *    controller's class-level guard resolves.
 *  - `CatalogModule` — exports `CATALOG_REPOSITORY_PORT` (PB-PR2-02
 *    additive export) so playback injects the PORT CONTRACT, never the
 *    concrete `PrismaCatalogRepository` adapter (C3 fix).
 *
 * Three providers, ALL via `useFactory` + `inject` (NEVER `useClass`
 * shorthand — matches the catalog + identity pattern and sidesteps the
 * esbuild/Vitest reflect-metadata caveat where constructor params resolve
 * to `undefined`). This holds even for `RangeParserAdapter` (zero-arg
 * constructor) for project-wide consistency.
 *
 * Symbol DI tokens (`AUDIO_STORAGE_PORT`, `RANGE_PARSER_PORT`,
 * `CATALOG_REPOSITORY_PORT`, `ENV_CONFIG`) — interfaces erase to
 * `undefined` at runtime, so Nest cannot resolve `provide: AudioStoragePort`.
 * Symbols survive erasure (C2 fix; mirrors identity's `IDENTITY_CONFIG`).
 */
@Module({
  imports: [PrismaModule, AuthModule, CatalogModule],
  controllers: [PlaybackController],
  providers: [
    // Audio storage adapter — wraps node:fs. Reads AUDIO_STORAGE_PATH off
    // the validated EnvConfig (REQ-PLAY-008 + C8 fix).
    {
      provide: AUDIO_STORAGE_PORT,
      useFactory: (config: EnvConfig) => new FsAudioStorage(config),
      inject: [ENV_CONFIG],
    },
    // Range-parser adapter — wraps the range-parser package. Zero-arg
    // constructor; explicit `useFactory: () => new ...()` form for
    // project-wide consistency (never `useClass`, even when valid).
    {
      provide: RANGE_PARSER_PORT,
      useFactory: () => new RangeParserAdapter(),
    },
    // Driving use case — orchestrates the three driven collaborators.
    // `inject` order MUST match StreamTrackUseCase's constructor param order
    // (catalog, storage, rangeParser) per the use-case signature.
    {
      provide: StreamTrackUseCase,
      useFactory: (
        catalogRepo: CatalogRepositoryPort,
        storage: AudioStoragePort,
        rangeParser: RangeParserPort,
      ) => new StreamTrackUseCase(catalogRepo, storage, rangeParser),
      inject: [CATALOG_REPOSITORY_PORT, AUDIO_STORAGE_PORT, RANGE_PARSER_PORT],
    },
  ],
})
export class PlaybackModule {}
