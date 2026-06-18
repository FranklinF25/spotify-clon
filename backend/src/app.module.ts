import { Module } from '@nestjs/common';

/**
 * Root application module.
 *
 * Foundation concerns (config, logger, health, error filter) are wired in by
 * task BF-12 once each module exists. Until then this module is intentionally
 * empty so the project compiles and boots.
 */
@Module({})
export class AppModule {}
