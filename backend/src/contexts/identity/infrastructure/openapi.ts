import { z } from 'zod';

import '../../../infrastructure/openapi-shared';
import { errorJson, type ContextOpenApiRegistrar } from '../../../infrastructure/openapi-shared';
import { loginSchema } from './dto/login.dto';
import { registerSchema } from './dto/register.dto';

/**
 * OpenAPI registry for the identity bounded context (API-DOC).
 *
 * Registers the five `AuthController` routes, REUSING the exact zod DTO
 * schemas the HTTP edge validates with (`dto/register.dto.ts`,
 * `dto/login.dto.ts`) — request contracts are imported, never re-declared,
 * so the document cannot drift from runtime validation.
 *
 * Response bodies have no zod schemas on the controller path (the handlers
 * return ad-hoc `{ accessToken, user }` objects built from
 * `User.toPrimitive()`), so minimal zod mirrors are declared below and
 * hand-synced to those shapes — same discipline as the frontend's
 * `src/types/api.ts` mirrors.
 *
 * Mount paths carry the full `/api/v1` prefix (set by `setGlobalPrefix` in
 * `main.ts`) because the document's `servers` entry is the bare host — this
 * keeps Scalar's "try it" URLs byte-identical to the real surface.
 */

/**
 * Zod mirror of `User.toPrimitive()` (`domain/user.entity.ts`): the public
 * profile WITHOUT `passwordHash` (dropped by the projection so the hash can
 * never leak through serialization) and WITHOUT `createdAt`/`updatedAt`.
 */
const userSchema = z
  .object({
    id: z.string().uuid(),
    email: z.string().email(),
    displayName: z.string(),
  })
  .openapi('Identity.User');

/**
 * Zod mirror of the `POST /auth/register` + `POST /auth/login` response
 * bodies (`AuthController.register` / `.login` return shapes). The refresh
 * token NEVER appears in the body — it rides the HttpOnly cookie set by the
 * controller (`res.cookie(REFRESH_COOKIE_NAME, ...)`).
 */
const authTokensSchema = z.object({
  accessToken: z.string().describe('Short-lived JWT access token (Authorization: Bearer <token>)'),
  user: userSchema,
});

/** Zod mirror of the `POST /auth/refresh` response body (`{ accessToken }`). */
const refreshResponseSchema = z.object({
  accessToken: z.string().describe('Rotated access token; a new refresh cookie is set alongside'),
});

/** Registrar — see the module docstring and `openapi-document.ts`. */
export const registerIdentityOpenApi: ContextOpenApiRegistrar = (registry) => {
  registry.registerPath({
    method: 'post',
    path: '/api/v1/auth/register',
    tags: ['identity'],
    summary: 'Register a new account',
    description:
      'Creates a user (email normalized lowercase, argon2 password hash) and returns an ' +
      'access token plus the public profile. A refresh-token HttpOnly cookie is set on success. ' +
      'Body validated by `registerSchema` (zod) — the same schema this document was generated from.',
    request: { body: { required: true, content: { 'application/json': { schema: registerSchema } } } },
    responses: {
      201: {
        description: 'Account created; refresh cookie set',
        content: { 'application/json': { schema: authTokensSchema } },
      },
      400: errorJson('Malformed body (email/password/displayName invariant, DESIGN §4.3 details[])'),
      409: errorJson('Email already registered (CONFLICT — no account creation)'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/auth/login',
    tags: ['identity'],
    summary: 'Log in',
    description:
      'Verifies credentials (argon2) and returns an access token plus the public profile. ' +
      'A refresh-token HttpOnly cookie is set on success. Failure is a generic 401 — no user enumeration.',
    request: { body: { required: true, content: { 'application/json': { schema: loginSchema } } } },
    responses: {
      200: {
        description: 'Authenticated; refresh cookie set',
        content: { 'application/json': { schema: authTokensSchema } },
      },
      400: errorJson('Malformed body (email format / empty password)'),
      401: errorJson('Unknown email or wrong password (indistinguishable by design)'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/auth/refresh',
    tags: ['identity'],
    summary: 'Rotate the access token',
    description:
      'Exchanges the HttpOnly refresh cookie for a new access token. The cookie is rotated ' +
      'on success only — a failed refresh never moves the credential. No request body.',
    responses: {
      200: {
        description: 'Access token rotated; refresh cookie rotated',
        content: { 'application/json': { schema: refreshResponseSchema } },
      },
      401: errorJson('Cookie missing, revoked, expired, or unknown'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/auth/logout',
    tags: ['identity'],
    summary: 'Log out',
    description:
      'Revokes the refresh-token row (when the cookie resolves) and clears the cookie. ' +
      'Always 204 — logout is idempotent by design.',
    responses: {
      204: { description: 'Logged out (cookie cleared)' },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/me',
    tags: ['identity'],
    summary: 'Current user profile',
    description:
      'JWT-guarded (`Authorization: Bearer`). Re-reads the user from the database so a ' +
      'deleted account surfaces as 401 even with a still-valid token.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Authenticated profile',
        content: { 'application/json': { schema: userSchema } },
      },
      401: errorJson('Missing, malformed, or expired access token'),
    },
  });
};
