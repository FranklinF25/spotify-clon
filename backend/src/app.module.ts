import { type MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';

import { AuthModule } from './contexts/identity/infrastructure/auth.module';
import { CatalogModule } from './contexts/catalog/infrastructure/catalog.module';
import { PlaybackModule } from './contexts/playback/infrastructure/playback.module';
import { PlaylistsModule } from './contexts/playlists/infrastructure/playlists.module';
import { ConfigModule } from './config.module';
import { GlobalExceptionFilter } from './exception.filter';
import { HealthController } from './health.controller';
import { AppLogger } from './logger';
import { RequestIdMiddleware } from './request-id.middleware';
import { PrismaModule } from './shared/prisma.module';

// Backward-compat re-export: every existing consumer of `'./app.module'`
// that imports `ENV_CONFIG` keeps resolving. The token's value is provided
// globally by `ConfigModule`; AppModule itself no longer declares the
// provider (single owner pattern, mirrors PrismaModule).
export { ENV_CONFIG } from './config.tokens';

/**
 * Root application module — wires the cross-cutting foundation:
 *  - validated env config (global DI token ENV_CONFIG, provided by
 *    ConfigModule so cross-context consumers like PlaybackModule can
 *    inject it without importing AppModule directly — mirrors
 *    PrismaModule's `@Global()` pattern),
 *  - structured pino logger with request-id correlation (AppLogger),
 *  - global exception filter (DESIGN 4.3 envelope),
 *  - request-id middleware on every route,
 *  - health endpoint,
 *  - global PrismaModule (single PrismaClient / single connection pool),
 * and imports the bounded contexts (identity, catalog, playback, playlists).
 */
@Module({
  imports: [ConfigModule, PrismaModule, AuthModule, CatalogModule, PlaybackModule, PlaylistsModule],
  controllers: [HealthController],
  providers: [AppLogger, { provide: APP_FILTER, useClass: GlobalExceptionFilter }],
  exports: [AppLogger],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
