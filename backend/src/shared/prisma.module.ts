import { Global, Module } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import { loadConfig } from '../config';

/**
 * Global Prisma wiring — the single owner of the {@link PrismaClient} instance
 * (catalog DESIGN §`PrismaModule` extraction).
 *
 * Contexts that need Prisma (`AuthModule`, future `CatalogModule`) import this
 * module instead of instantiating their own client. Centralizing the client
 * here keeps one connection pool per process; the previous pattern — each
 * module declaring its own `useFactory: () => new PrismaClient(...)` — would
 * spawn a second pool once `CatalogModule` joins `AuthModule`, doubling the
 * database connections under load.
 *
 * The factory reuses the validated {@link loadConfig} so the underlying
 * `datasources.db.url` always matches the rest of the process (env-driven in
 * production, overrideable in tests via `process.env.DATABASE_URL`).
 */
@Global()
@Module({
  providers: [
    {
      provide: PrismaClient,
      useFactory: () => {
        const cfg = loadConfig();
        return new PrismaClient({
          datasources: { db: { url: cfg.DATABASE_URL } },
        });
      },
    },
  ],
  exports: [PrismaClient],
})
export class PrismaModule {}
