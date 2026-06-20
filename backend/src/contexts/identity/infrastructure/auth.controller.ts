import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { RefreshTokenUseCase } from '../application/refresh-token.use-case';
import { LoginUseCase } from '../application/login.use-case';
import { LogoutUseCase } from '../application/logout.use-case';
import { RegisterUseCase } from '../application/register.use-case';
import type { UserRepositoryPort } from '../domain/ports/user-repository.port';
import { UnauthorizedError } from '../../../shared/errors/unauthorized-error';
import { JwtAuthGuard, type RequestWithUser } from './auth.guard';
import type { CookieConfig } from './cookies';
import { REFRESH_COOKIE_NAME, refreshCookieOptions } from './cookies';
import { loginSchema } from './dto/login.dto';
import { registerSchema } from './dto/register.dto';
import { validate } from './dto/validate';
import { PrismaUserRepository } from './prisma-user.repository';

/**
 * DI token for the refresh-cookie attributes (secure flag + path), provided by
 * `AuthModule` from the validated env config. Declared at the top so class
 * decorators below can reference it safely.
 */
export const COOKIE_CONFIG = Symbol('COOKIE_CONFIG');

/**
 * HTTP adapter for the identity context.
 *
 * Routes (under the global `/api/v1` prefix):
 *   - POST /auth/register → RegisterUseCase, sets refresh cookie
 *   - POST /auth/login    → LoginUseCase, sets refresh cookie
 *   - POST /auth/refresh  → RefreshTokenUseCase, rotates refresh cookie
 *   - POST /auth/logout   → LogoutUseCase, clears refresh cookie (always 204)
 *   - GET  /me            → guarded; returns the authenticated profile
 *
 * The controller is intentionally thin: it shapes input (DTO + validate), drives
 * a use case, then translates the result into HTTP (status, cookie, body). All
 * business decisions live in the application/domain layers. Errors thrown by the
 * use cases (ConflictError / UnauthorizedError / ValidationError) are normalized
 * into the DESIGN §4.3 envelope by the global exception filter.
 */
@Controller()
export class AuthController {
  constructor(
    @Inject(RegisterUseCase) private readonly registerUseCase: RegisterUseCase,
    @Inject(LoginUseCase) private readonly loginUseCase: LoginUseCase,
    @Inject(RefreshTokenUseCase) private readonly refreshUseCase: RefreshTokenUseCase,
    @Inject(LogoutUseCase) private readonly logoutUseCase: LogoutUseCase,
    @Inject(PrismaUserRepository) private readonly users: UserRepositoryPort,
    @Inject(COOKIE_CONFIG) private readonly cookieConfig: CookieConfig,
  ) {}

  @Post('auth/register')
  async register(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const result = await this.registerUseCase.execute(validate(registerSchema, body));
    res.cookie(REFRESH_COOKIE_NAME, result.refreshTokenValue, refreshCookieOptions(this.cookieConfig));
    return { accessToken: result.accessToken, user: result.user };
  }

  @Post('auth/login')
  @HttpCode(200)
  async login(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const result = await this.loginUseCase.execute(validate(loginSchema, body));
    res.cookie(REFRESH_COOKIE_NAME, result.refreshTokenValue, refreshCookieOptions(this.cookieConfig));
    return { accessToken: result.accessToken, user: result.user };
  }

  @Post('auth/refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const cookie = req.cookies?.[REFRESH_COOKIE_NAME];
    // Throws Unauthorized when the cookie is missing/invalid/expired or the row
    // is revoked — the use case owns all those checks. The new cookie is only
    // set on success, so a failed refresh never rotates the credential.
    const result = await this.refreshUseCase.execute({ refreshTokenValue: cookie });
    res.cookie(REFRESH_COOKIE_NAME, result.refreshTokenValue, refreshCookieOptions(this.cookieConfig));
    return { accessToken: result.accessToken };
  }

  @Post('auth/logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const cookie = req.cookies?.[REFRESH_COOKIE_NAME];
    await this.logoutUseCase.execute({ refreshTokenValue: cookie });
    res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieOptions(this.cookieConfig));
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@Req() req: RequestWithUser) {
    // req.user is populated by JwtAuthGuard; the DB lookup fetches displayName
    // (not on the access token) and verifies the user still exists.
    const user = await this.users.findById(req.user!.sub);
    if (!user) {
      throw new UnauthorizedError();
    }
    return user.toPrimitive();
  }
}
