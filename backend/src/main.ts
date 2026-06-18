import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

/**
 * Application entrypoint.
 *
 * Bootstraps the NestJS application under the `/api/v1` global prefix. The
 * listening port is read from `PORT` (default 3000); it is replaced by the
 * Zod-validated config value once the config module is wired (BF-12).
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api/v1');
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

void bootstrap();
