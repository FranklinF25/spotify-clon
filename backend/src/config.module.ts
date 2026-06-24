import { Global, Module } from '@nestjs/common';

import { type EnvConfig, loadConfig } from './config';
import { ENV_CONFIG } from './config.tokens';

/**
 * Global config wiring — single owner of the validated {@link EnvConfig}
 * instance (PB-PR2-07 follow-up; mirrors {@link PrismaModule}'s `@Global()`
 * pattern).
 *
 * The prior wiring declared ENV_CONFIG inside {@link AppModule} and added it
 * to AppModule's `exports`. That works ONLY for modules that IMPORT
 * AppModule — but AppModule is the ROOT module, so no module imports it.
 * Cross-context consumers like {@link PlaybackModule}'s `FsAudioStorage`
 * factory inject `ENV_CONFIG` and need it to resolve from the global scope.
 *
 * Marking the module `@Global()` lets every context resolve ENV_CONFIG
 * WITHOUT importing this module explicitly (mirrors how `PrismaModule`
 * makes `PrismaClient` globally available). The factory calls
 * {@link loadConfig} once per process boot; the resulting object is shared
 * by reference across every adapter that injects ENV_CONFIG.
 *
 * The factory runs at module-construction time and calls `loadConfig()`
 * which validates `process.env` via Zod. Test harnesses set the env vars
 * BEFORE the testing module compiles; production boots fail-fast on a
 * missing or invalid env.
 */
@Global()
@Module({
  providers: [{ provide: ENV_CONFIG, useFactory: (): EnvConfig => loadConfig() }],
  exports: [ENV_CONFIG],
})
export class ConfigModule {}
