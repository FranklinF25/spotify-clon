import { type MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';

import { AuthModule } from './contexts/identity/infrastructure/auth.module';
import { CatalogModule } from './contexts/catalog/infrastructure/catalog.module';
import { PlaybackModule } from './contexts/playback/infrastructure/playback.module';
import { loadConfig, type EnvConfig } from './config';
// CRIT-3 — `ENV_CONFIG` is imported (binds the value into this module's
// local scope so the `provide: ENV_CONFIG` line below compiles) AND
// re-exported (so existing consumers of `'./app.module'` keep resolving).
import { ENV_CONFIG } from './config.tokens';
import { GlobalExceptionFilter } from './exception.filter';
import { HealthController } from './health.controller';
import { AppLogger } from './logger';
import { RequestIdMiddleware } from './request-id.middleware';
import { PrismaModule } from './shared/prisma.module';

export { ENV_CONFIG } from './config.tokens';

/**
 * Root application module — wires the cross-cutting foundation:
 *  - validated env config (DI token ENV_CONFIG),
 *  - structured pino logger with request-id correlation (AppLogger),
 *  - global exception filter (DESIGN 4.3 envelope),
 *  - request-id middleware on every route,
 *  - health endpoint,
 *  - global PrismaModule (single PrismaClient / single connection pool),
 * and imports the bounded contexts (identity, catalog, playback).
 */
@Module({
  imports: [PrismaModule, AuthModule, CatalogModule, PlaybackModule],
  controllers: [HealthController],
  providers: [
    { provide: ENV_CONFIG, useFactory: (): EnvConfig => loadConfig() },
    AppLogger,
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
  exports: [ENV_CONFIG, AppLogger],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
