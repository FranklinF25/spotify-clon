import { type MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';

import { AuthModule } from './contexts/identity/infrastructure/auth.module';
import { loadConfig, type EnvConfig } from './config';
import { GlobalExceptionFilter } from './exception.filter';
import { HealthController } from './health.controller';
import { AppLogger } from './logger';
import { RequestIdMiddleware } from './request-id.middleware';
import { PrismaModule } from './shared/prisma.module';

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
 *  - health endpoint,
 *  - global PrismaModule (single PrismaClient / single connection pool),
 * and imports the identity bounded context (AuthModule).
 */
@Module({
  imports: [PrismaModule, AuthModule],
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
