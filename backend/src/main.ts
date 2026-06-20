import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';

import { AppModule } from './app.module';
import { loadConfig } from './config';
import { AppLogger } from './logger';

/**
 * Application entrypoint.
 *
 * Loads and validates environment configuration (fail-fast), boots the Nest
 * application under the `/api/v1` global prefix — keeping `/health` outside the
 * versioned prefix for load-balancer probes — wires cookie parsing (so the
 * identity refresh-token cookie is readable on /auth/refresh and /auth/logout),
 * and routes logs through the request-correlated pino logger.
 */
async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.useLogger(app.get(AppLogger));
  app.use(cookieParser());
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });

  await app.listen(config.PORT);
}

void bootstrap();
