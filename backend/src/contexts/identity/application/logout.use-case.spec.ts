import { describe, expect, it } from 'vitest';

import { RefreshToken } from '../domain/refresh-token.entity';
import { LogoutUseCase } from './logout.use-case';
import {
  FakeJwtSigner,
  InMemoryRefreshTokenRepository,
  SEVEN_DAYS_MS,
} from '../../../../test/helpers/identity-fakes';

/**
 * Unit tests for `LogoutUseCase` (identity application layer).
 *
 * Underpins spec scenarios:
 *   - "Logout revokes presented token"
 *   - "Logout revokes only the presented token"
 *   - "Logout is idempotent without a valid cookie".
 */
describe('LogoutUseCase', () => {
  function setup() {
    const refreshTokens = new InMemoryRefreshTokenRepository();
    const jwt = new FakeJwtSigner();
    const useCase = new LogoutUseCase(refreshTokens, jwt);
    return { useCase, refreshTokens, jwt };
  }

  function seed(
    repo: InMemoryRefreshTokenRepository,
    opts: { id?: string; userId?: string; jti?: string; revoke?: boolean },
  ): RefreshToken {
    const token = RefreshToken.issue({
      id: opts.id ?? `rt-${opts.jti ?? 'x'}`,
      userId: opts.userId ?? 'user-1',
      jti: opts.jti ?? 'jti-x',
      now: new Date(),
      ttlMs: SEVEN_DAYS_MS,
    });
    if (opts.revoke) {
      token.revoke(new Date());
    }
    repo.saved.push(token);
    return token;
  }

  it('revokes the presented active token', async () => {
    const { useCase, refreshTokens, jwt } = setup();
    const r1 = seed(refreshTokens, { jti: 'jti-r1' });
    jwt.refreshToVerify = {
      sub: 'user-1',
      jti: 'jti-r1',
      email: 'user-1@example.com',
    };

    await useCase.execute({ refreshTokenValue: 'any' });

    expect(r1.revokedAt).not.toBeNull();
  });

  it('revokes ONLY the presented token — other active tokens for the same user are untouched', async () => {
    const { useCase, refreshTokens, jwt } = setup();
    const r1 = seed(refreshTokens, { userId: 'user-1', jti: 'jti-r1' });
    const r2 = seed(refreshTokens, { userId: 'user-1', jti: 'jti-r2' });
    jwt.refreshToVerify = {
      sub: 'user-1',
      jti: 'jti-r1',
      email: 'user-1@example.com',
    };

    await useCase.execute({ refreshTokenValue: 'any' });

    expect(r1.revokedAt).not.toBeNull();
    expect(r2.revokedAt).toBeNull();
  });

  it('is idempotent when no refresh token is presented (cookie absent)', async () => {
    const { useCase, refreshTokens } = setup();

    await expect(useCase.execute({})).resolves.toBeUndefined();
    expect(refreshTokens.saved).toHaveLength(0);
  });

  it('is idempotent when the JWT cannot be verified (garbage cookie)', async () => {
    const { useCase, jwt, refreshTokens } = setup();
    jwt.verifyFails = true;

    await expect(
      useCase.execute({ refreshTokenValue: 'garbage' }),
    ).resolves.toBeUndefined();
    expect(refreshTokens.saved).toHaveLength(0);
  });

  it('is idempotent when the jti is unknown to the repository', async () => {
    const { useCase, jwt, refreshTokens } = setup();
    jwt.refreshToVerify = {
      sub: 'user-1',
      jti: 'unknown-jti',
      email: 'user-1@example.com',
    };

    await expect(
      useCase.execute({ refreshTokenValue: 'any' }),
    ).resolves.toBeUndefined();
    expect(refreshTokens.saved).toHaveLength(0);
  });

  it('is idempotent when the presented token is already revoked (no double-write)', async () => {
    const { useCase, refreshTokens, jwt } = setup();
    const token = seed(refreshTokens, { jti: 'jti-already', revoke: true });
    const before = token.revokedAt;
    jwt.refreshToVerify = {
      sub: 'user-1',
      jti: 'jti-already',
      email: 'user-1@example.com',
    };

    await useCase.execute({ refreshTokenValue: 'any' });

    // revokedAt is the original timestamp (RefreshToken.revoke is idempotent),
    // and no second save takes place (repo still has exactly one row).
    expect(token.revokedAt).toBe(before);
    expect(refreshTokens.saved).toHaveLength(1);
  });
});
