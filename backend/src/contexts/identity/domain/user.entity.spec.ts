import { describe, expect, it } from 'vitest';

import { ValidationError } from '../../../shared/errors/validation-error';
import { User } from './user.entity';

/**
 * Unit tests for the `User` root aggregate (identity bounded context).
 *
 * Framework-agnostic — only vitest + relative imports (the architecture
 * portfolio test enforces that invariant stays true). These specs underpin the
 * spec scenarios "Successful registration", "Invalid email format", and the
 * password / displayName invariants.
 */
const fixedNow = new Date('2025-01-01T00:00:00.000Z');

describe('User entity', () => {
  describe('User.register', () => {
    it('creates a user when all invariants hold', () => {
      const user = User.register({
        id: 'uid-1',
        email: 'alice@example.com',
        passwordHash: 'hashed-secret',
        displayName: 'Alice',
        now: fixedNow,
      });

      expect(user.id).toBe('uid-1');
      expect(user.email).toBe('alice@example.com');
      expect(user.passwordHash).toBe('hashed-secret');
      expect(user.displayName).toBe('Alice');
      expect(user.createdAt).toBe(fixedNow);
      expect(user.updatedAt).toBe(fixedNow);
    });

    it('normalizes a messy email to trimmed lowercase', () => {
      const user = User.register({
        id: 'uid-2',
        email: '  Alice@Example.COM ',
        passwordHash: 'hashed-secret',
        displayName: 'Alice',
        now: fixedNow,
      });

      expect(user.email).toBe('alice@example.com');
    });

    it('rejects an invalid email format with a ValidationError on the email field', () => {
      try {
        User.register({
          id: 'uid-3',
          email: 'not-an-email',
          passwordHash: 'hashed-secret',
          displayName: 'Alice',
          now: fixedNow,
        });
        throw new Error('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ValidationError);
        const v = err as ValidationError;
        expect(v.details?.[0]?.field).toBe('email');
      }
    });

    it('rejects an empty password hash with a ValidationError on the password field', () => {
      try {
        User.register({
          id: 'uid-4',
          email: 'alice@example.com',
          passwordHash: '',
          displayName: 'Alice',
          now: fixedNow,
        });
        throw new Error('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ValidationError);
        const v = err as ValidationError;
        expect(v.details?.[0]?.field).toBe('password');
      }
    });

    it('rejects a blank displayName with a ValidationError on the displayName field', () => {
      try {
        User.register({
          id: 'uid-5',
          email: 'alice@example.com',
          passwordHash: 'hashed-secret',
          displayName: '   ',
          now: fixedNow,
        });
        throw new Error('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ValidationError);
        const v = err as ValidationError;
        expect(v.details?.[0]?.field).toBe('displayName');
      }
    });

    it('rejects a displayName longer than 100 characters', () => {
      expect(() =>
        User.register({
          id: 'uid-6',
          email: 'alice@example.com',
          passwordHash: 'hashed-secret',
          displayName: 'x'.repeat(101),
          now: fixedNow,
        }),
      ).toThrow(ValidationError);
    });

    it('accepts a 100-character displayName (boundary)', () => {
      const user = User.register({
        id: 'uid-7',
        email: 'alice@example.com',
        passwordHash: 'hashed-secret',
        displayName: 'x'.repeat(100),
        now: fixedNow,
      });

      expect(user.displayName).toHaveLength(100);
    });

    it('trims leading and trailing whitespace from the displayName', () => {
      const user = User.register({
        id: 'uid-8',
        email: 'alice@example.com',
        passwordHash: 'hashed-secret',
        displayName: '  Alice  ',
        now: fixedNow,
      });

      expect(user.displayName).toBe('Alice');
    });
  });

  describe('User.rename', () => {
    it('updates displayName and bumps updatedAt', () => {
      const user = User.register({
        id: 'uid-r1',
        email: 'alice@example.com',
        passwordHash: 'hashed-secret',
        displayName: 'Alice',
        now: fixedNow,
      });
      const later = new Date('2025-02-01T00:00:00.000Z');

      user.rename('Alice Smith', later);

      expect(user.displayName).toBe('Alice Smith');
      expect(user.updatedAt).toBe(later);
    });

    it('rejects an invalid new displayName', () => {
      const user = User.register({
        id: 'uid-r2',
        email: 'alice@example.com',
        passwordHash: 'hashed-secret',
        displayName: 'Alice',
        now: fixedNow,
      });

      expect(() => user.rename('   ', fixedNow)).toThrow(ValidationError);
    });
  });

  describe('User.toPrimitive', () => {
    it('returns the public projection without the password hash', () => {
      const user = User.register({
        id: 'uid-p1',
        email: 'alice@example.com',
        passwordHash: 'hashed-secret',
        displayName: 'Alice',
        now: fixedNow,
      });

      const projection = user.toPrimitive();

      expect(projection).toEqual({
        id: 'uid-p1',
        email: 'alice@example.com',
        displayName: 'Alice',
      });
      // The hash must never transit the public projection.
      expect(JSON.stringify(projection)).not.toContain('hashed-secret');
    });
  });
});
