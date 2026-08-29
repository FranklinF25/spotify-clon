import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';

import { AppModule } from './app.module';
import { loadConfig } from './config';
import {
  API_REFERENCE_PATH,
  OPENAPI_JSON_PATH,
  buildOpenApiDocument,
} from './infrastructure/openapi-document';
import { AppLogger } from './logger';

/**
 * Application entrypoint.
 *
 * Loads and validates environment configuration (fail-fast), boots the Nest
 * application under the `/api/v1` global prefix — keeping `/health` outside the
 * versioned prefix for load-balancer probes — wires cookie parsing (so the
 * identity refresh-token cookie is readable on /auth/refresh and /auth/logout),
 * and routes logs through the request-correlated pino logger.
 *
 * API reference mounts (API-DOC, both PUBLIC — the doc leaks nothing; the
 * endpoints it describes stay guarded):
 *  - `GET /api/v1/openapi.json` — the machine document, built ONCE at boot
 *    (`buildOpenApiDocument()` memoizes; the handler closes over the object,
 *    never regenerating per request).
 *  - `/api/v1/reference` — the Scalar UI (dark Kepler theme to match the app).
 *
 * Both are RAW express handlers mounted BEFORE `app.listen()` — Nest mounts
 * its router during `listen()→init()`, so anything registered here sits in
 * front of Nest routing. `app.use`/`app.get` bypass Nest's global prefix
 * machinery, which is exactly why the `/api/v1` segment is spelled out in
 * the paths (a Nest-side route would get the prefix injected; these do not).
 */
async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.useLogger(app.get(AppLogger));
  app.use(cookieParser());
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });

  const openApiDocument = buildOpenApiDocument();
  // Raw express middleware (NOT a Nest route): `INestApplication.get()` is
  // the DI container getter, so route-style mounting goes through `use`.
  // GET/HEAD only — anything else falls through to Nest (404 envelope).
  app.use(OPENAPI_JSON_PATH, (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next();
      return;
    }
    res.json(openApiDocument);
  });
  // Scalar UI as a self-contained HTML page (API-DOC): the
  // @scalar/nestjs-api-reference middleware wrapper require()s the ESM-only
  // @scalar/client-side-rendering from its CJS dist and crashes a CommonJS
  // Nest boot (ERR_REQUIRE_ESM) — so we serve Scalar's documented HTML/JS
  // quickstart shape directly, pointing at our JSON document. The bundle
  // loads from jsDelivr (pinned major) at view time; the document itself
  // is served locally, so the spec never depends on the CDN.
  app.use(API_REFERENCE_PATH, (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next();
      return;
    }
    res.type('html').send(`<!doctype html>
<html>
  <head>
    <title>Spotify Clon API Reference</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>body { margin: 0; }</style>
  </head>
  <body>
    <div id="app"></div>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference@1"></script>
    <script>
      Scalar.createApiReference('#app', {
        url: '${OPENAPI_JSON_PATH}',
        theme: 'kepler',
        darkMode: true,
      });
    </script>
  </body>
</html>`);
  });

  await app.listen(config.PORT);
}

void bootstrap();
