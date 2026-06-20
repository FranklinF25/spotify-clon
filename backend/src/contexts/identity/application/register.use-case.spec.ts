import { describe, expect, it } from 'vitest';

import { ConflictError } from '../../../shared/errors/conflict-error';
import { RegisterUseCase } from './register.use-case';
import {
  FakeJwtSigner,
  FakePasswordHasher,
  InMemoryRefreshTokenRepository,
  InMemoryUserRepository,
  SEVEN_DAYS_MS,
} from '../../../../test/helpers/identity-fakes';

/**
 * Unit tests for `RegisterUseCase` (identity application layer).
 *
 * Each test wires the use case with in-memory port fakes (DESIGN mocking
 * strategy). Underpins spec scenarios "Successful registration" and
 * "Duplicate email returns CONFLICT".
 */
describe('RegisterUseCase', () => {
  function setup() {
    const users = new InMemoryUserRepository();
    const refreshTokens = new InMemoryRefreshTokenRepository();
    const hasher = new FakePasswordHasher();
    const jwt = new FakeJwtSigner();
    const useCase = new RegisterUseCase(users, refreshTokens, hasher, jwt, {
      refreshTokenTtlMs: SEVEN_DAYS_MS,
    });
    return { useCase, users, refreshTokens, hasher, jwt };
  }

  it('registers a new user, persists it, and returns access + refresh tokens', async () => {
    const { useCase, users, refreshTokens, hasher, jwt } = setup();

    const result = await useCase.execute({
      email: 'alice@example.com',
      password: 'password123',
      displayName: 'Alice',
    });

    // User projection (no password hash) returned to the caller.
    expect(result.user).toEqual({
      id: expect.any(String),
      email: 'alice@example.com',
      displayName: 'Alice',
    });
    // Access + refresh tokens are opaque strings signed by the fake.
    expect(result.accessToken).toBe(`access(${result.user.id}:alice@example.com)`);
    expect(result.refreshTokenValue).toMatch(/^refresh\(/);

    // User row persisted with the hash, not the plain password.
    expect(users.saved).toHaveLength(1);
    expect(users.saved[0].email).toBe('alice@example.com');
    expect(users.saved[0].passwordHash).toBe('hashed(password123)');

    // Password was hashed exactly once.
    expect(hasher.hashed).toEqual(['password123']);

    // Refresh token row persisted against the new user id.
    expect(refreshTokens.saved).toHaveLength(1);
    expect(refreshTokens.saved[0].userId).toBe(result.user.id);
    expect(refreshTokens.saved[0].revokedAt).toBeNull();

    // Both access + refresh JWTs were signed with the new user as subject.
    expect(jwt.accessSigned).toHaveLength(1);
    expect(jwt.refreshSigned).toHaveLength(1);
    expect(jwt.accessSigned[0]).toEqual({
      sub: result.user.id,
      email: 'alice@example.com',
    });
    expect(jwt.refreshSigned[0]).toEqual({
      sub: result.user.id,
      jti: expect.any(String),
      email: 'alice@example.com',
    });
  });

  it('throws ConflictError before hashing when the email already exists', async () => {
    const { useCase, users, hasher } = setup();
    users.existsEmails.add('alice@example.com');

    await expect(
      useCase.execute({
        email: 'alice@example.com',
        password: 'password123',
        displayName: 'Alice',
      }),
    ).rejects.toBeInstanceOf(ConflictError);

    // Conflict short-circuits before any write.
    expect(users.saved).toHaveLength(0);
    expect(hasher.hashed).toHaveLength(0);
  });

  it('normalises the email (trim + lowercase) before persisting and signing', async () => {
    const { useCase, users, jwt } = setup();

    const result = await useCase.execute({
      email: '  Alice@Example.COM ',
      password: 'password123',
      displayName: 'Alice',
    });

    expect(users.saved[0].email).toBe('alice@example.com');
    expect(result.user.email).toBe('alice@example.com');
    expect(jwt.refreshSigned[0].email).toBe('alice@example.com');
  });

  it('binds the persisted refresh token jti to the signed refresh JWT jti', async () => {
    const { useCase, refreshTokens, jwt } = setup();

    await useCase.execute({
      email: 'alice@example.com',
      password: 'password123',
      displayName: 'Alice',
    });

    const signedJti = jwt.refreshSigned[0].jti;
    const persistedJti = refreshTokens.saved[0].jti;
    expect(signedJti).toBe(persistedJti);
    expect(signedJti).toMatch(/^[0-9a-f-]{36}$/i);
  });
});
