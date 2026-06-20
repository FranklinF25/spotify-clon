import { describe, expect, it } from 'vitest';

import { UnauthorizedError } from '../../../shared/errors/unauthorized-error';
import { RefreshToken } from '../domain/refresh-token.entity';
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

    expect(refreshTokens.revokeAllAndSaveCalls).toEqual([
      { userId: 'user-alice' },
    ]);
    expect(refreshTokens.revokedAllFor).toEqual([]);
  });

  it('issues revokeAllAndSave atomically — does not call revokeAllForUser + save separately', async () => {
    const { useCase, users, refreshTokens } = setup();
    seedUser(users);

    await useCase.execute({ email: 'alice@example.com', password: 'password123' });

    // The atomic port method is the only revocation path. The separate
    // revokeAllForUser + save sequence must NOT fire (S4 fix).
    expect(refreshTokens.revokeAllAndSaveCalls).toHaveLength(1);
    expect(refreshTokens.revokedAllFor).toEqual([]);
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

describe('InMemoryRefreshTokenRepository.revokeAllAndSave — atomic rollback (S4 regression)', () => {
  it('rolls back the prior-token revocation when the new-token save throws', async () => {
    const refreshTokens = new InMemoryRefreshTokenRepository();
    // Seed an active prior token that the atomic op should revoke.
    const prior = RefreshToken.issue({
      id: 'rt-prior',
      userId: 'user-alice',
      jti: 'jti-prior',
      now: new Date(),
      ttlMs: SEVEN_DAYS_MS,
    });
    refreshTokens.saved.push(prior);

    // Build a new token whose save will throw (configured via the fake).
    const newToken = RefreshToken.issue({
      id: 'rt-new',
      userId: 'user-alice',
      jti: 'jti-new',
      now: new Date(),
      ttlMs: SEVEN_DAYS_MS,
    });
    refreshTokens.saveShouldThrow = new Error('unique violation');

    await expect(
      refreshTokens.revokeAllAndSave('user-alice', newToken),
    ).rejects.toThrow('unique violation');

    // Atomic guarantee: the prior row was NEVER revoked (rolled back).
    expect(prior.revokedAt).toBeNull();
  });
});
