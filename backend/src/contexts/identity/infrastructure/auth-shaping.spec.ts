import { describe, expect, it } from 'vitest';

import type { CookieConfig } from './cookies';
import { REFRESH_COOKIE_NAME, refreshCookieOptions } from './cookies';
import { loginSchema } from './dto/login.dto';
import { registerSchema } from './dto/register.dto';
import { validate } from './dto/validate';
import { ValidationError } from '../../../shared/errors/validation-error';

/**
 * Unit specs for the request-validation + cookie helpers used by AuthController.
 *
 * These pin the DTO contracts (so the e2e specs can trust input shaping) and
 * the cookie option builder (HttpOnly + SameSite=Lax + scoped Path, Secure
 * driven by env) without spinning up Nest.
 */
describe('identity infrastructure - request shaping', () => {
  describe('registerSchema / validate', () => {
    it('accepts a valid register body', () => {
      const data = validate(registerSchema, {
        email: 'alice@example.com',
        password: 'password123',
        displayName: 'Alice',
      });

      expect(data).toEqual({
        email: 'alice@example.com',
        password: 'password123',
        displayName: 'Alice',
      });
    });

    it('throws a ValidationError with a password detail when the password is too short', () => {
      try {
        validate(registerSchema, {
          email: 'alice@example.com',
          password: '1234567',
          displayName: 'Alice',
        });
        throw new Error('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ValidationError);
        const fields = (err as ValidationError).details?.map((d) => d.field) ?? [];
        expect(fields).toContain('password');
      }
    });

    it('throws a ValidationError with an email detail when the email is malformed', () => {
      try {
        validate(registerSchema, {
          email: 'not-an-email',
          password: 'password123',
          displayName: 'Alice',
        });
        throw new Error('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ValidationError);
        const fields = (err as ValidationError).details?.map((d) => d.field) ?? [];
        expect(fields).toContain('email');
      }
    });

    it('throws a ValidationError with a displayName detail when displayName is empty', () => {
      try {
        validate(registerSchema, {
          email: 'alice@example.com',
          password: 'password123',
          displayName: '',
        });
        throw new Error('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ValidationError);
        const fields = (err as ValidationError).details?.map((d) => d.field) ?? [];
        expect(fields).toContain('displayName');
      }
    });
  });

  describe('loginSchema / validate', () => {
    it('accepts a valid login body', () => {
      const data = validate(loginSchema, { email: 'alice@example.com', password: 'anything' });
      expect(data).toEqual({ email: 'alice@example.com', password: 'anything' });
    });

    it('rejects a missing password with a password detail', () => {
      try {
        validate(loginSchema, { email: 'alice@example.com' });
        throw new Error('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ValidationError);
        expect((err as ValidationError).details?.some((d) => d.field === 'password')).toBe(true);
      }
    });
  });

  describe('refreshCookieOptions', () => {
    const baseConfig: CookieConfig = { secure: false, path: '/api/v1/auth' };

    it('builds HttpOnly + SameSite=Lax + scoped Path options', () => {
      const opts = refreshCookieOptions(baseConfig);

      expect(opts).toMatchObject({
        httpOnly: true,
        sameSite: 'lax',
        path: '/api/v1/auth',
      });
    });

    it('omits Secure when config.secure is false', () => {
      expect(refreshCookieOptions({ secure: false, path: '/api/v1/auth' }).secure).toBe(false);
    });

    it('sets Secure when config.secure is true (production)', () => {
      expect(refreshCookieOptions({ secure: true, path: '/api/v1/auth' }).secure).toBe(true);
    });

    it('exposes the stable refresh cookie name', () => {
      expect(REFRESH_COOKIE_NAME).toBe('refreshToken');
    });
  });
});
