import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';

import { UnauthorizedError } from '../../../shared/errors/unauthorized-error';
import type { AccessTokenPayload, JwtSignerPort } from '../domain/ports/jwt-signer.port';

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
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtSignerPort) {}

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
