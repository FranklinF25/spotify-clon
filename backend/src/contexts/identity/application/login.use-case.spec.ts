import { describe, expect, it } from 'vitest';

import { UnauthorizedError } from '../../../shared/errors/unauthorized-error';
import { User } from '../domain/user.entity';
import { LoginUseCase } from './login.use-case';
import {
  FakeJwtSigner,
  FakePasswordHasher,
  InMemoryRefreshTokenRepository,
  InMemoryUserRepository,
  SEVEN_DAYS_MS,
} from '../../../../test/helpers/identity-fakes';

/**
 * Unit tests for `LoginUseCase` (identity application layer).
 *
 * Underpins spec scenarios:
 *   - "Valid credentials"
 *   - "Wrong password returns generic UNAUTHORIZED"
 *   - "Unknown email returns indistinguishable UNAUTHORIZED"
 *   - "New login revokes prior refresh tokens" (single-session).
 */
describe('LoginUseCase', () => {
  function setup() {
    const users = new InMemoryUserRepository();
    const refreshTokens = new InMemoryRefreshTokenRepository();
    const hasher = new FakePasswordHasher();
    const jwt = new FakeJwtSigner();
    const useCase = new LoginUseCase(users, refreshTokens, hasher, jwt, {
      refreshTokenTtlMs: SEVEN_DAYS_MS,
    });
    return { useCase, users, refreshTokens, hasher, jwt };
  }

  function seedUser(
    users: InMemoryUserRepository,
    opts: { id?: string; email?: string; password?: string; displayName?: string } = {},
  ): User {
    const email = opts.email ?? 'alice@example.com';
    const password = opts.password ?? 'password123';
    const user = User.register({
      id: opts.id ?? 'user-alice',
      email,
      passwordHash: `hashed(${password})`,
      displayName: opts.displayName ?? 'Alice',
      now: new Date('2025-01-01T00:00:00.000Z'),
    });
    users.saved.push(user);
    users.existsEmails.add(email);
    return user;
  }

  it('logs in a registered user with the correct password and returns access + refresh tokens', async () => {
    const { useCase, users, refreshTokens, jwt } = setup();
    seedUser(users);

    const result = await useCase.execute({
      email: 'alice@example.com',
      password: 'password123',
    });

    expect(result.user).toEqual({
      id: 'user-alice',
      email: 'alice@example.com',
      displayName: 'Alice',
    });
    expect(result.accessToken).toBe('access(user-alice:alice@example.com)');
    expect(result.refreshTokenValue).toMatch(/^refresh\(/);

    expect(refreshTokens.saved).toHaveLength(1);
    expect(jwt.refreshSigned[0]).toEqual({
      sub: 'user-alice',
      jti: expect.any(String),
      email: 'alice@example.com',
    });
    expect(jwt.accessSigned[0]).toEqual({
      sub: 'user-alice',
      email: 'alice@example.com',
    });
  });

  it('throws UnauthorizedError when the password is wrong', async () => {
    const { useCase, users } = setup();
    seedUser(users);

    await expect(
      useCase.execute({ email: 'alice@example.com', password: 'wrong-password' }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('throws UnauthorizedError when the email is unknown', async () => {
    const { useCase } = setup();

    await expect(
      useCase.execute({ email: 'unknown@example.com', password: 'whatever' }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('produces an indistinguishable UnauthorizedError for wrong password vs unknown email (no user enumeration)', async () => {
    const { useCase, users } = setup();
    seedUser(users);

    const wrongPassword = await useCase
      .execute({ email: 'alice@example.com', password: 'wrong' })
      .catch((e) => e);
    const unknownEmail = await useCase
      .execute({ email: 'unknown@example.com', password: 'whatever' })
      .catch((e) => e);

    expect(wrongPassword).toBeInstanceOf(UnauthorizedError);
    expect(unknownEmail).toBeInstanceOf(UnauthorizedError);
    expect(wrongPassword.code).toBe(unknownEmail.code);
    expect(wrongPassword.message).toBe(unknownEmail.message);
    expect(wrongPassword.status).toBe(unknownEmail.status);
    expect(wrongPassword.details).toBe(unknownEmail.details);
  });

  it('hashes a dummy password on unknown email to keep response timing uniform (constant-time defence)', async () => {
    const { useCase, hasher } = setup();

    await expect(
      useCase.execute({ email: 'unknown@example.com', password: 'whatever' }),
    ).rejects.toBeInstanceOf(UnauthorizedError);

    expect(hasher.hashed).toEqual(['whatever']);
  });

  it('revokes all prior active refresh tokens for the user on successful login (single-session)', async () => {
    const { useCase, users, refreshTokens } = setup();
    seedUser(users);

    await useCase.execute({ email: 'alice@example.com', password: 'password123' });

    expect(refreshTokens.revokedAllFor).toEqual([
      { userId: 'user-alice', exceptJti: undefined },
    ]);
  });

  it('normalises the email before looking the user up', async () => {
    const { useCase, users } = setup();
    seedUser(users, { email: 'alice@example.com' });

    const result = await useCase.execute({
      email: '  Alice@Example.COM ',
      password: 'password123',
    });

    expect(result.user.email).toBe('alice@example.com');
  });
});
