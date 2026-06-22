import { Module } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import ms, { type StringValue } from 'ms';

import { type EnvConfig, loadConfig } from '../../../config';
import { PrismaModule } from '../../../shared/prisma.module';
import { LoginUseCase } from '../application/login.use-case';
import { LogoutUseCase } from '../application/logout.use-case';
import { RefreshTokenUseCase } from '../application/refresh-token.use-case';
import { RegisterUseCase } from '../application/register.use-case';
import { ArgonPasswordHasher } from './argon-password-hasher';
import { COOKIE_CONFIG, AuthController } from './auth.controller';
import { JwtAuthGuard } from './auth.guard';
import { NestJwtSigner } from './nest-jwt-signer';
import { PrismaRefreshTokenRepository } from './prisma-refresh-token.repository';
import { PrismaUserRepository } from './prisma-user.repository';

/**
 * DI token for the validated env config, local to the identity module. Kept
 * private (not exported) — AppModule owns its own ENV_CONFIG; this reads the
 * same `process.env` so both stay in sync. Centralizing it here means every
 * adapter factory injects a single typed config object instead of re-parsing.
 */
const IDENTITY_CONFIG = Symbol('IDENTITY_CONFIG');

/**
 * Wires the identity bounded context for the HTTP layer.
 *
 * Adapters (Prisma repositories, argon2 hasher, JWT signer) are bound to their
 * driven ports and constructed with the validated config. The four use cases
 * are each built with their port dependencies + the refresh TTL (derived from
 * `JWT_REFRESH_TTL` so the DB row's `expires_at` stays in lockstep with the
 * JWT `exp`). The controller and JwtAuthGuard resolve everything by class DI.
 *
 * `PrismaClient` is provided by the global `PrismaModule` (single connection
 * pool per process) — imported here so the repositories can resolve it without
 * the AppModule having to re-declare it.
 */
@Module({
  imports: [PrismaModule],
  controllers: [AuthController],
  providers: [
    { provide: IDENTITY_CONFIG, useFactory: (): EnvConfig => loadConfig() },

    {
      provide: PrismaUserRepository,
      inject: [PrismaClient],
      useFactory: (prisma: PrismaClient) => new PrismaUserRepository(prisma),
    },
    {
      provide: PrismaRefreshTokenRepository,
      inject: [PrismaClient],
      useFactory: (prisma: PrismaClient) => new PrismaRefreshTokenRepository(prisma),
    },
    {
      provide: ArgonPasswordHasher,
      inject: [IDENTITY_CONFIG],
      useFactory: (cfg: EnvConfig) =>
        new ArgonPasswordHasher({
          memoryCost: cfg.ARGON2_MEMORY_COST,
          timeCost: cfg.ARGON2_TIME_COST,
          parallelism: cfg.ARGON2_PARALLELISM,
        }),
    },
    {
      provide: NestJwtSigner,
      inject: [IDENTITY_CONFIG],
      useFactory: (cfg: EnvConfig) =>
        new NestJwtSigner({
          accessSecret: cfg.JWT_ACCESS_SECRET,
          refreshSecret: cfg.JWT_REFRESH_SECRET,
          // Zod already validated these against the ms format, so the cast to
          // StringValue is sound and keeps expiresIn type-safe end to end.
          accessTtl: cfg.JWT_ACCESS_TTL as StringValue,
          refreshTtl: cfg.JWT_REFRESH_TTL as StringValue,
          issuer: cfg.JWT_ISSUER,
          audience: cfg.JWT_AUDIENCE,
        }),
    },

    {
      provide: RegisterUseCase,
      inject: [PrismaUserRepository, PrismaRefreshTokenRepository, ArgonPasswordHasher, NestJwtSigner, IDENTITY_CONFIG],
      useFactory: (users, refreshTokens, hasher, jwt, cfg: EnvConfig) =>
        new RegisterUseCase(users, refreshTokens, hasher, jwt, {
          refreshTokenTtlMs: ms(cfg.JWT_REFRESH_TTL as StringValue),
        }),
    },
    {
      provide: LoginUseCase,
      inject: [PrismaUserRepository, PrismaRefreshTokenRepository, ArgonPasswordHasher, NestJwtSigner, IDENTITY_CONFIG],
      useFactory: (users, refreshTokens, hasher, jwt, cfg: EnvConfig) =>
        new LoginUseCase(users, refreshTokens, hasher, jwt, {
          refreshTokenTtlMs: ms(cfg.JWT_REFRESH_TTL as StringValue),
        }),
    },
    {
      provide: RefreshTokenUseCase,
      inject: [PrismaRefreshTokenRepository, NestJwtSigner, IDENTITY_CONFIG],
      useFactory: (refreshTokens, jwt, cfg: EnvConfig) =>
        new RefreshTokenUseCase(refreshTokens, jwt, {
          refreshTokenTtlMs: ms(cfg.JWT_REFRESH_TTL as StringValue),
        }),
    },
    {
      provide: LogoutUseCase,
      inject: [PrismaRefreshTokenRepository, NestJwtSigner],
      useFactory: (refreshTokens, jwt) => new LogoutUseCase(refreshTokens, jwt),
    },

    {
      provide: COOKIE_CONFIG,
      inject: [IDENTITY_CONFIG],
      useFactory: (cfg: EnvConfig) => ({
        secure: cfg.COOKIE_SECURE,
        path: cfg.REFRESH_COOKIE_PATH,
      }),
    },

    JwtAuthGuard,
  ],
})
export class AuthModule {}
