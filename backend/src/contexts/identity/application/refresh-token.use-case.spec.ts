import { describe, expect, it } from 'vitest';

import { UnauthorizedError } from '../../../shared/errors/unauthorized-error';
import { RefreshToken } from '../domain/refresh-token.entity';
import { RefreshTokenUseCase } from './refresh-token.use-case';
import {
  FakeJwtSigner,
  InMemoryRefreshTokenRepository,
  SEVEN_DAYS_MS,
} from '../../../../test/helpers/identity-fakes';

/**
 * Unit tests for `RefreshTokenUseCase` (identity application layer).
 *
 * Underpins spec scenarios:
 *   - "Successful rotation"
 *   - "Expired refresh token is rejected"
 *   - "Missing refresh token cookie"
 *   - "Revoked refresh token cannot be used".
 *
 * The fake JWT signer stages whatever claims the use case should see on
 * verify, or throws on verify when `verifyFails` is set. This lets us
 * exercise every rejection branch without depending on a real JWT library.
 */
describe('RefreshTokenUseCase', () => {
  function setup() {
    const refreshTokens = new InMemoryRefreshTokenRepository();
    const jwt = new FakeJwtSigner();
    const useCase = new RefreshTokenUseCase(refreshTokens, jwt, {
      refreshTokenTtlMs: SEVEN_DAYS_MS,
    });
    return { useCase, refreshTokens, jwt };
  }

  function seedToken(
    repo: InMemoryRefreshTokenRepository,
    opts: {
      id?: string;
      userId?: string;
      jti?: string;
      issuedAt?: Date;
      ttlMs?: number;
      revoke?: boolean;
    } = {},
  ): RefreshToken {
    // Default `issuedAt` to the real current time so the token is active at
    // the use case's `new Date()` check. Tests that need an expired or revoked
    // token override `ttlMs` or set `revoke: true`.
    const issuedAt = opts.issuedAt ?? new Date();
    const token = RefreshToken.issue({
      id: opts.id ?? `rt-${opts.jti ?? 'current'}`,
      userId: opts.userId ?? 'user-1',
      jti: opts.jti ?? 'jti-current',
      now: issuedAt,
      ttlMs: opts.ttlMs ?? SEVEN_DAYS_MS,
    });
    if (opts.revoke) {
      token.revoke(new Date());
    }
    repo.saved.push(token);
    return token;
  }

  it('rotates: revokes the presented row, inserts a new row, returns a new access + refresh token', async () => {
    const { useCase, refreshTokens, jwt } = setup();
    const presented = seedToken(refreshTokens, { userId: 'user-1', jti: 'jti-old' });
    jwt.refreshToVerify = {
      sub: 'user-1',
      jti: 'jti-old',
      email: 'user-1@example.com',
    };

    const result = await useCase.execute({ refreshTokenValue: 'any-value' });

    expect(result.accessToken).toBe('access(user-1:user-1@example.com)');
    expect(result.refreshTokenValue).toMatch(/^refresh\(/);

    // Rotation step 1: presented row is revoked.
    expect(presented.revokedAt).not.toBeNull();
    // Rotation step 2: a new (un-revoked) row was inserted for the same user.
    expect(refreshTokens.saved).toHaveLength(2);
    const newRow = refreshTokens.saved[1];
    expect(newRow.userId).toBe('user-1');
    expect(newRow.jti).not.toBe('jti-old');
    expect(newRow.revokedAt).toBeNull();
    // The signed refresh JWT uses the new jti.
    expect(jwt.refreshSigned[0].jti).toBe(newRow.jti);
    expect(jwt.refreshSigned[0].sub).toBe('user-1');
  });

  it('throws Unauthorized when the refresh token value is missing (controller passes undefined cookie)', async () => {
    const { useCase } = setup();

    await expect(
      useCase.execute({ refreshTokenValue: undefined }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('throws Unauthorized when the refresh JWT cannot be verified', async () => {
    const { useCase, jwt } = setup();
    jwt.verifyFails = true;

    await expect(
      useCase.execute({ refreshTokenValue: 'garbage' }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('throws Unauthorized when the jti is not in the repository', async () => {
    const { useCase, jwt } = setup();
    jwt.refreshToVerify = {
      sub: 'user-1',
      jti: 'unknown-jti',
      email: 'user-1@example.com',
    };

    await expect(
      useCase.execute({ refreshTokenValue: 'any' }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('throws Unauthorized when the presented token is already revoked (rotation reuse defence)', async () => {
    const { useCase, refreshTokens, jwt } = setup();
    seedToken(refreshTokens, { jti: 'jti-revoked', revoke: true });
    jwt.refreshToVerify = {
      sub: 'user-1',
      jti: 'jti-revoked',
      email: 'user-1@example.com',
    };

    await expect(
      useCase.execute({ refreshTokenValue: 'any' }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('throws Unauthorized when revokeIfActive loses the concurrent rotation race (atomic reuse defence)', async () => {
    const { useCase, refreshTokens, jwt } = setup();
    seedToken(refreshTokens, { jti: 'jti-racy' });
    jwt.refreshToVerify = {
      sub: 'user-1',
      jti: 'jti-racy',
      email: 'user-1@example.com',
    };
    // Simulate the losing side of a concurrent rotation: another request
    // already revoked the row atomically, so revokeIfActive returns false.
    refreshTokens.revokeIfActiveResult = false;

    await expect(
      useCase.execute({ refreshTokenValue: 'any' }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    // The loser must never insert a new active row.
    expect(refreshTokens.saved).toHaveLength(1);
  });

  it('rolls back the revocation when the new-token save fails mid-rotation (R2-3 atomicity)', async () => {
    const { useCase, refreshTokens, jwt } = setup();
    const presented = seedToken(refreshTokens, { jti: 'jti-old-rollback' });
    jwt.refreshToVerify = {
      sub: 'user-1',
      jti: 'jti-old-rollback',
      email: 'user-1@example.com',
    };
    // Simulate a unique-violation on the new jti mid-rotation.
    refreshTokens.saveShouldThrow = new Error('unique jti violation');

    await expect(
      useCase.execute({ refreshTokenValue: 'any' }),
    ).rejects.toThrow('unique jti violation');

    // Atomic guarantee: the old row was NEVER actually revoked (rolled back).
    expect(presented.revokedAt).toBeNull();
    // No new row was inserted.
    expect(refreshTokens.saved).toHaveLength(1);
  });

  it('throws Unauthorized when the presented token is expired', async () => {
    const { useCase, refreshTokens, jwt } = setup();
    // ttlMs=0 → expiresAt = issuedAt (2025-01-01); current real time is past that,
    // so isActive() at use-case time returns false.
    seedToken(refreshTokens, { jti: 'jti-expired', ttlMs: 0 });
    jwt.refreshToVerify = {
      sub: 'user-1',
      jti: 'jti-expired',
      email: 'user-1@example.com',
    };

    await expect(
      useCase.execute({ refreshTokenValue: 'any' }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });
});
