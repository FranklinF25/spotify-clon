import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';

import { UnauthorizedError } from '../../../shared/errors/unauthorized-error';
import type { AccessTokenPayload } from '../domain/ports/jwt-signer.port';
import { NestJwtSigner } from './nest-jwt-signer';

/**
 * Augmented Express request carrying the verified access-token claims once the
 * {@link JwtAuthGuard} allows the request through. Downstream handlers read
 * `req.user.sub` / `req.user.email` without re-verifying.
 */
export interface RequestWithUser extends Request {
  user?: AccessTokenPayload;
}

/**
 * Guards protected routes (currently `GET /me`) by requiring a verifiable
 * Bearer access token.
 *
 * Every failure mode collapses into a single {@link UnauthorizedError} so the
 * response is always the generic 401 envelope (spec: "Missing access token"
 * and "Invalid or expired access token" are indistinguishable to the caller —
 * no oracle about whether the token existed, was malformed, or merely expired).
 *
 * Depends on the concrete `NestJwtSigner` adapter (not just the port) so NestJS
 * DI can resolve it by class metadata; the guard still talks to it through the
 * `JwtSignerPort` contract at runtime.
 *
 * The `@Inject(NestJwtSigner)` is explicit on purpose: under Vitest, TypeScript
 * is transpiled by esbuild which (unlike `tsc`) does NOT emit
 * `design:paramtypes` metadata, so constructor injection by reflected type
 * fails silently (the dependency resolves to `undefined`). Explicit
 * `@Inject()` stores the token under Nest's `self:paramtypes` key, which does
 * not depend on compiler metadata and works under both `tsc` (production) and
 * esbuild (tests). Every other class in this module is built through
 * `useFactory` with explicit `inject: [...]`, so the guard is the only spot
 * that needed it.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(@Inject(NestJwtSigner) private readonly jwt: NestJwtSigner) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestWithUser>();
    const header = req.headers.authorization;

    if (!header || !header.toLowerCase().startsWith('bearer ')) {
      throw new UnauthorizedError();
    }

    const token = header.slice('bearer '.length).trim();
    try {
      req.user = await this.jwt.verifyAccessToken(token);
      return true;
    } catch {
      throw new UnauthorizedError();
    }
  }
}
