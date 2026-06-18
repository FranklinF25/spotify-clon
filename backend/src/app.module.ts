import { type MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';

import { loadConfig, type EnvConfig } from './config';
import { GlobalExceptionFilter } from './exception.filter';
import { HealthController } from './health.controller';
import { AppLogger } from './logger';
import { RequestIdMiddleware } from './request-id.middleware';

/**
 * DI token for the validated environment configuration.
 * Contexts and adapters inject this instead of reading process.env directly.
 */
export const ENV_CONFIG = Symbol('ENV_CONFIG');

/**
 * Root application module — wires the cross-cutting foundation:
 *  - validated env config (DI token ENV_CONFIG),
 *  - structured pino logger with request-id correlation (AppLogger),
 *  - global exception filter (DESIGN 4.3 envelope),
 *  - request-id middleware on every route,
 *  - health endpoint.
 *
 * Bounded contexts are imported here as they land (identity in PR-3).
 */
@Module({
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
