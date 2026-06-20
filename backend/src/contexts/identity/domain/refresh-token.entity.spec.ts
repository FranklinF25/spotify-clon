import { describe, expect, it } from 'vitest';

import { RefreshToken } from './refresh-token.entity';

/**
 * Unit tests for the `RefreshToken` entity (identity bounded context).
 *
 * Framework-agnostic — only vitest + a relative import. These specs underpin
 * the spec scenarios "New login revokes prior refresh tokens",
 * "Expired refresh token is rejected", and the rotation invariants.
 */
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const issuedAt = new Date('2025-01-01T00:00:00.000Z');

describe('RefreshToken entity', () => {
  describe('RefreshToken.issue', () => {
    it('creates an active token with expiresAt = now + ttlMs', () => {
      const token = RefreshToken.issue({
        id: 'rt-1',
        userId: 'user-1',
        jti: 'jti-1',
        now: issuedAt,
        ttlMs: SEVEN_DAYS_MS,
      });

      expect(token.id).toBe('rt-1');
      expect(token.userId).toBe('user-1');
      expect(token.jti).toBe('jti-1');
      expect(token.issuedAt).toBe(issuedAt);
      expect(token.expiresAt).toEqual(new Date(issuedAt.getTime() + SEVEN_DAYS_MS));
      expect(token.revokedAt).toBeNull();
      expect(token.createdAt).toBe(issuedAt);
    });

    it('is active immediately after issue', () => {
      const token = RefreshToken.issue({
        id: 'rt-2',
        userId: 'user-1',
        jti: 'jti-2',
        now: issuedAt,
        ttlMs: SEVEN_DAYS_MS,
      });

      expect(token.isActive(issuedAt)).toBe(true);
      expect(token.isRevoked(issuedAt)).toBe(false);
      expect(token.isExpired(issuedAt)).toBe(false);
    });

    it('computes expiresAt from ttlMs=0 as exactly issuedAt', () => {
      const token = RefreshToken.issue({
        id: 'rt-3',
        userId: 'user-1',
        jti: 'jti-3',
        now: issuedAt,
        ttlMs: 0,
      });

      expect(token.expiresAt).toEqual(issuedAt);
      // At exactly expiresAt, isExpired returns true (>= comparison).
      expect(token.isExpired(issuedAt)).toBe(true);
    });
  });

  describe('RefreshToken.revoke', () => {
    it('marks the token revoked at the given time', () => {
      const token = RefreshToken.issue({
        id: 'rt-4',
        userId: 'user-1',
        jti: 'jti-4',
        now: issuedAt,
        ttlMs: SEVEN_DAYS_MS,
      });
      const revokedAt = new Date('2025-01-02T00:00:00.000Z');

      token.revoke(revokedAt);

      expect(token.revokedAt).toBe(revokedAt);
      expect(token.isRevoked(revokedAt)).toBe(true);
      expect(token.isActive(revokedAt)).toBe(false);
    });

    it('is idempotent — a second revoke call keeps the first timestamp', () => {
      const token = RefreshToken.issue({
        id: 'rt-5',
        userId: 'user-1',
        jti: 'jti-5',
        now: issuedAt,
        ttlMs: SEVEN_DAYS_MS,
      });
      const first = new Date('2025-01-02T00:00:00.000Z');
      const second = new Date('2025-01-03T00:00:00.000Z');

      token.revoke(first);
      token.revoke(second);

      expect(token.revokedAt).toBe(first);
    });
  });

  describe('RefreshToken.isExpired', () => {
    it('returns false just before expiresAt and true at/after it', () => {
      const token = RefreshToken.issue({
        id: 'rt-6',
        userId: 'user-1',
        jti: 'jti-6',
        now: issuedAt,
        ttlMs: SEVEN_DAYS_MS,
      });
      const justBefore = new Date(issuedAt.getTime() + SEVEN_DAYS_MS - 1);
      const atExpiry = new Date(issuedAt.getTime() + SEVEN_DAYS_MS);
      const afterExpiry = new Date(issuedAt.getTime() + SEVEN_DAYS_MS + 1);

      expect(token.isExpired(justBefore)).toBe(false);
      expect(token.isExpired(atExpiry)).toBe(true);
      expect(token.isExpired(afterExpiry)).toBe(true);
    });
  });

  describe('RefreshToken.isActive', () => {
    it('returns false for a revoked-but-not-expired token', () => {
      const token = RefreshToken.issue({
        id: 'rt-7',
        userId: 'user-1',
        jti: 'jti-7',
        now: issuedAt,
        ttlMs: SEVEN_DAYS_MS,
      });
      token.revoke(new Date('2025-01-02T00:00:00.000Z'));

      expect(token.isActive(issuedAt)).toBe(false);
    });

    it('returns false for an expired-but-not-revoked token', () => {
      const token = RefreshToken.issue({
        id: 'rt-8',
        userId: 'user-1',
        jti: 'jti-8',
        now: issuedAt,
        ttlMs: SEVEN_DAYS_MS,
      });
      const afterExpiry = new Date(issuedAt.getTime() + SEVEN_DAYS_MS + 1);

      expect(token.isActive(afterExpiry)).toBe(false);
    });

    it('returns true only when neither revoked nor expired', () => {
      const token = RefreshToken.issue({
        id: 'rt-9',
        userId: 'user-1',
        jti: 'jti-9',
        now: issuedAt,
        ttlMs: SEVEN_DAYS_MS,
      });
      const midLife = new Date(issuedAt.getTime() + 60_000);

      expect(token.isActive(midLife)).toBe(true);
    });
  });

  describe('RefreshToken.reconstruct', () => {
    it('rebuilds a token from a persistence row preserving revokedAt', () => {
      const issuedAtRow = new Date('2024-01-01T00:00:00.000Z');
      const expiresAtRow = new Date('2024-02-01T00:00:00.000Z');
      const revokedAtRow = new Date('2024-01-15T00:00:00.000Z');
      const createdAtRow = new Date('2024-01-01T00:00:00.000Z');

      const token = RefreshToken.reconstruct({
        id: 'rt-rc-1',
        userId: 'user-rc',
        jti: 'jti-rc',
        issuedAt: issuedAtRow,
        expiresAt: expiresAtRow,
        revokedAt: revokedAtRow,
        createdAt: createdAtRow,
      });

      expect(token.id).toBe('rt-rc-1');
      expect(token.userId).toBe('user-rc');
      expect(token.jti).toBe('jti-rc');
      expect(token.issuedAt).toBe(issuedAtRow);
      expect(token.expiresAt).toBe(expiresAtRow);
      expect(token.revokedAt).toBe(revokedAtRow);
      expect(token.createdAt).toBe(createdAtRow);
      // A reconstructed-but-revoked token must report revoked/active correctly.
      expect(token.isRevoked()).toBe(true);
      expect(token.isActive(issuedAtRow)).toBe(false);
    });

    it('rebuilds an active token when revokedAt is null', () => {
      const token = RefreshToken.reconstruct({
        id: 'rt-rc-2',
        userId: 'user-rc',
        jti: 'jti-rc-2',
        issuedAt: new Date('2024-01-01T00:00:00.000Z'),
        expiresAt: new Date('2099-01-01T00:00:00.000Z'),
        revokedAt: null,
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
      });

      expect(token.revokedAt).toBeNull();
      expect(token.isActive(new Date())).toBe(true);
    });
  });
});
