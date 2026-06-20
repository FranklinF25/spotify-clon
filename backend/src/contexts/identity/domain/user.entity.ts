import { ValidationError } from '../../../shared/errors/validation-error';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DISPLAY_NAME_MAX = 100;

/**
 * Identity user — root aggregate of the identity bounded context.
 *
 * The plain password never lives here: only the hash transits the boundary.
 * The hash is omitted from the public projection (`toPrimitive`) so it can
 * never leak through serialization.
 *
 * Invariants (enforced by `register`):
 *   - email matches the simple RFC-ish regex, normalised lowercase + trimmed,
 *   - passwordHash is non-empty (the policy check on the PLAIN password lives
 *     at the application / DTO layer; the entity only guarantees a hash is
 *     present so we never persist a user without one),
 *   - displayName trims to length 1..100.
 */
export class User {
  private constructor(
    public readonly id: string,
    public readonly email: string,
    public readonly passwordHash: string,
    public displayName: string,
    public readonly createdAt: Date,
    public updatedAt: Date,
  ) {}

  /**
   * Factory for a newly-registered user. Throws `ValidationError` on any
   * invariant breach so callers cannot construct an invalid user.
   */
  static register(input: {
    id: string;
    email: string;
    passwordHash: string;
    displayName: string;
    now: Date;
  }): User {
    const email = input.email.trim().toLowerCase();
    if (!EMAIL_REGEX.test(email)) {
      throw new ValidationError('Email is not valid', [
        { field: 'email', issue: 'invalid_format' },
      ]);
    }
    if (input.passwordHash.length === 0) {
      throw new ValidationError('Password hash is required', [
        { field: 'password', issue: 'missing' },
      ]);
    }
    const displayName = input.displayName.trim();
    if (displayName.length < 1 || displayName.length > DISPLAY_NAME_MAX) {
      throw new ValidationError('Display name must be between 1 and 100 characters', [
        { field: 'displayName', issue: 'invalid_length' },
      ]);
    }
    return new User(
      input.id,
      email,
      input.passwordHash,
      displayName,
      input.now,
      input.now,
    );
  }

  /**
   * Renames the user. Validates the new display name against the same rule as
   * `register` and bumps `updatedAt` to `now`.
   */
  rename(newName: string, now: Date = new Date()): void {
    const trimmed = newName.trim();
    if (trimmed.length < 1 || trimmed.length > DISPLAY_NAME_MAX) {
      throw new ValidationError('Display name must be between 1 and 100 characters', [
        { field: 'displayName', issue: 'invalid_length' },
      ]);
    }
    this.displayName = trimmed;
    this.updatedAt = now;
  }

  /**
   * Public projection for API responses. Drops `passwordHash` so the hash can
   * never accidentally leak through serialization.
   */
  toPrimitive(): { id: string; email: string; displayName: string } {
    return { id: this.id, email: this.email, displayName: this.displayName };
  }
}
