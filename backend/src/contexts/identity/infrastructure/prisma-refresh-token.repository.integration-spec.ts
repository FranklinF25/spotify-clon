import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { TestDbContext } from '../../../../test/helpers/test-db';
import { startTestDb } from '../../../../test/helpers/test-db';
import { RefreshToken } from '../domain/refresh-token.entity';
import { PrismaRefreshTokenRepository } from './prisma-refresh-token.repository';

/**
 * PrismaRefreshTokenRepository integration — real Postgres 16 via testcontainers.
 *
 * Pins the `RefreshTokenRepositoryPort` contract: findByJti, findActiveByUser
 * (active = revokedAt IS NULL AND expires_at > now), save (insert + revoke
 * persistence), revoke, and the single-session kill switch revokeAllForUser
 * (with the exceptJti exclusion used during rotation). One container per file;
 * TRUNCATE between tests.
 */
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

describe('PrismaRefreshTokenRepository', () => {
  let db: TestDbContext;
  let prisma: PrismaClient;
  let repo: PrismaRefreshTokenRepository;
  let userId: string;

  beforeAll(async () => {
    db = await startTestDb();
    prisma = db.prisma;
    repo = new PrismaRefreshTokenRepository(prisma);
  }, 60_000);

  beforeEach(async () => {
    await db.truncate();
    const user = await prisma.user.create({
      data: { email: 'alice@example.com', passwordHash: 'h', displayName: 'Alice' },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await db.cleanup();
  });

  const issueToken = (jti: string, overrides: Partial<Parameters<typeof RefreshToken.issue>[0]> = {}) =>
    RefreshToken.issue({
      id: crypto.randomUUID(),
      userId,
      jti,
      // Real clock so the token is genuinely active (expires 7 days in the
      // future) for the findActiveByUser > now filter. The expired-token case
      // is built separately via RefreshToken.reconstruct with past dates.
      now: new Date(),
      ttlMs: SEVEN_DAYS_MS,
      ...overrides,
    });

  describe('save (insert) + findByJti', () => {
    it('persists a freshly issued token and finds it by jti', async () => {
      const token = issueToken('jti-A');
      await repo.save(token);

      const found = await repo.findByJti('jti-A');

      expect(found).not.toBeNull();
      expect(found?.userId).toBe(userId);
      expect(found?.jti).toBe('jti-A');
      expect(found?.revokedAt).toBeNull();
    });

    it('preserves expiresAt/issuedAt across the round-trip', async () => {
      const now = new Date('2024-02-01T00:00:00Z');
      const token = RefreshToken.issue({
        id: crypto.randomUUID(),
        userId,
        jti: 'jti-dates',
        now,
        ttlMs: SEVEN_DAYS_MS,
      });
      await repo.save(token);

      const found = await repo.findByJti('jti-dates');
      expect(found?.issuedAt).toEqual(now);
      expect(found?.expiresAt).toEqual(new Date(now.getTime() + SEVEN_DAYS_MS));
    });

    it('returns null when the jti is unknown', async () => {
      expect(await repo.findByJti('does-not-exist')).toBeNull();
    });
  });

  describe('save (update — persist revoke)', () => {
    it('persists a revoke() mutation on a subsequent save', async () => {
      const token = issueToken('jti-update');
      await repo.save(token);

      const revokedAt = new Date('2024-03-01T00:00:00Z');
      token.revoke(revokedAt);
      await repo.save(token);

      const found = await repo.findByJti('jti-update');
      expect(found?.revokedAt).toEqual(revokedAt);
    });
  });

  describe('revoke', () => {
    it('marks the token revoked and persists the timestamp', async () => {
      const token = issueToken('jti-revoke');
      await repo.save(token);

      await repo.revoke(token);

      const found = await repo.findByJti('jti-revoke');
      expect(found?.revokedAt).not.toBeNull();
      expect(token.revokedAt).not.toBeNull();
    });

    it('is idempotent — second revoke keeps the first timestamp', async () => {
      const token = issueToken('jti-revoke-2');
      await repo.save(token);
      await repo.revoke(token);
      const first = token.revokedAt!;

      await repo.revoke(token);

      expect(token.revokedAt).toEqual(first);
    });
  });

  describe('findActiveByUser', () => {
    it('returns only active tokens (excludes revoked and expired)', async () => {
      const active = issueToken('jti-active');
      const revoked = issueToken('jti-revoked');
      revoked.revoke(new Date('2024-01-02T00:00:00Z'));
      const expired = RefreshToken.reconstruct({
        id: crypto.randomUUID(),
        userId,
        jti: 'jti-expired',
        issuedAt: new Date('2020-01-01T00:00:00Z'),
        expiresAt: new Date('2020-02-01T00:00:00Z'),
        revokedAt: null,
        createdAt: new Date('2020-01-01T00:00:00Z'),
      });
      await repo.save(active);
      await repo.save(revoked);
      await repo.save(expired);

      const result = await repo.findActiveByUser(userId);

      expect(result).toHaveLength(1);
      expect(result[0]?.jti).toBe('jti-active');
    });

    it('returns an empty array when the user has no active tokens', async () => {
      const token = issueToken('jti-only-revoked');
      token.revoke(new Date());
      await repo.save(token);

      expect(await repo.findActiveByUser(userId)).toEqual([]);
    });
  });

  describe('revokeAllForUser (single-session kill switch)', () => {
    it('revokes every active token for the user', async () => {
      const a = issueToken('r1');
      const b = issueToken('r2');
      const c = issueToken('r3');
      await repo.save(a);
      await repo.save(b);
      await repo.save(c);

      await repo.revokeAllForUser(userId);

      expect(await repo.findActiveByUser(userId)).toEqual([]);
      expect((await repo.findByJti('r1'))?.isRevoked()).toBe(true);
      expect((await repo.findByJti('r2'))?.isRevoked()).toBe(true);
      expect((await repo.findByJti('r3'))?.isRevoked()).toBe(true);
    });

    it('spares the exceptJti (rotation preserves the freshly issued row)', async () => {
      const keep = issueToken('keep');
      const kill = issueToken('kill');
      await repo.save(keep);
      await repo.save(kill);

      await repo.revokeAllForUser(userId, 'keep');

      const active = await repo.findActiveByUser(userId);
      expect(active).toHaveLength(1);
      expect(active[0]?.jti).toBe('keep');
      expect((await repo.findByJti('kill'))?.isRevoked()).toBe(true);
    });

    it('does not touch tokens belonging to another user', async () => {
      const other = await prisma.user.create({
        data: { email: 'bob@example.com', passwordHash: 'h', displayName: 'Bob' },
      });
      const mine = issueToken('mine');
      const theirs = RefreshToken.issue({
        id: crypto.randomUUID(),
        userId: other.id,
        jti: 'theirs',
        now: new Date(),
        ttlMs: SEVEN_DAYS_MS,
      });
      await repo.save(mine);
      await repo.save(theirs);

      await repo.revokeAllForUser(userId);

      expect((await repo.findByJti('theirs'))?.isRevoked()).toBe(false);
      expect((await repo.findByJti('mine'))?.isRevoked()).toBe(true);
    });

    it('is idempotent — re-running on an already-clean user is a no-op', async () => {
      const a = issueToken('once');
      await repo.save(a);
      await repo.revokeAllForUser(userId);

      await expect(repo.revokeAllForUser(userId)).resolves.toBeUndefined();
      expect(await repo.findActiveByUser(userId)).toEqual([]);
    });
  });

  describe('revokeIfActive (atomic rotation primitive)', () => {
    it('returns true and revokes when the row is still active', async () => {
      const token = issueToken('jti-atomic-active');
      await repo.save(token);
      const at = new Date('2024-05-01T00:00:00Z');

      const ok = await repo.revokeIfActive('jti-atomic-active', at);

      expect(ok).toBe(true);
      const found = await repo.findByJti('jti-atomic-active');
      expect(found?.revokedAt).toEqual(at);
    });

    it('returns false and does not mutate when the row was already revoked', async () => {
      const token = issueToken('jti-atomic-revoked');
      token.revoke(new Date('2024-05-01T00:00:00Z'));
      await repo.save(token);

      const ok = await repo.revokeIfActive('jti-atomic-revoked', new Date('2024-06-01T00:00:00Z'));

      expect(ok).toBe(false);
      // Original timestamp preserved — the conditional UPDATE matched 0 rows.
      const found = await repo.findByJti('jti-atomic-revoked');
      expect(found?.revokedAt).toEqual(new Date('2024-05-01T00:00:00Z'));
    });

    it('returns false when the jti does not exist', async () => {
      expect(await repo.revokeIfActive('no-such-jti', new Date())).toBe(false);
    });
  });

  describe('revokeAllAndSave (single-transaction single-session kill switch)', () => {
    it('revokes every prior active token and inserts the new one in one transaction', async () => {
      const old1 = issueToken('old-1');
      const old2 = issueToken('old-2');
      await repo.save(old1);
      await repo.save(old2);
      const newToken = issueToken('new');

      await repo.revokeAllAndSave(userId, newToken);

      const active = await repo.findActiveByUser(userId);
      expect(active).toHaveLength(1);
      expect(active[0]?.jti).toBe('new');
      expect((await repo.findByJti('old-1'))?.isRevoked()).toBe(true);
      expect((await repo.findByJti('old-2'))?.isRevoked()).toBe(true);
    });

    it('does not touch tokens belonging to another user', async () => {
      const other = await prisma.user.create({
        data: { email: 'carol@example.com', passwordHash: 'h', displayName: 'Carol' },
      });
      const theirs = RefreshToken.issue({
        id: crypto.randomUUID(),
        userId: other.id,
        jti: 'theirs',
        now: new Date(),
        ttlMs: SEVEN_DAYS_MS,
      });
      await repo.save(theirs);
      const newToken = issueToken('mine');

      await repo.revokeAllAndSave(userId, newToken);

      expect((await repo.findByJti('theirs'))?.isRevoked()).toBe(false);
    });

    it('rolls back the prior-token revocations when the new-token insert violates the jti unique constraint (R2-2 atomicity)', async () => {
      // Pre-seed an active token for the user — this is the row that must
      // SURVIVE the rollback (still active afterwards).
      const oldActive = issueToken('old-active');
      await repo.save(oldActive);
      // Pre-seed a row whose jti will collide with the new token's jti.
      const collision = issueToken('collision-jti');
      await repo.save(collision);
      // The new token we attempt to insert reuses the colliding jti.
      const newToken = issueToken('collision-jti');

      await expect(repo.revokeAllAndSave(userId, newToken)).rejects.toThrow();

      // Atomicity guarantee (S4 / R2-2): the upsert failure rolled back the
      // prior-row revocations, so oldActive is STILL active.
      const survivor = await repo.findByJti('old-active');
      expect(survivor?.revokedAt).toBeNull();
      expect(survivor?.isActive()).toBe(true);
    });
  });

  describe('revokeIfActiveAndSave (atomic rotation primitive)', () => {
    it('revokes the presented row and inserts the new token when the row is still active', async () => {
      const old = issueToken('rot-active');
      await repo.save(old);
      const newToken = issueToken('rot-new');

      const ok = await repo.revokeIfActiveAndSave('rot-active', new Date('2024-05-01T00:00:00Z'), newToken);

      expect(ok).toBe(true);
      const oldRow = await repo.findByJti('rot-active');
      expect(oldRow?.revokedAt).toEqual(new Date('2024-05-01T00:00:00Z'));
      const newRow = await repo.findByJti('rot-new');
      expect(newRow?.isActive()).toBe(true);
    });

    it('returns false and does NOT insert when the presented row was already revoked (reuse)', async () => {
      const old = issueToken('rot-reuse');
      old.revoke(new Date('2024-05-01T00:00:00Z'));
      await repo.save(old);
      const newToken = issueToken('rot-new-reuse');

      const ok = await repo.revokeIfActiveAndSave('rot-reuse', new Date('2024-06-01T00:00:00Z'), newToken);

      expect(ok).toBe(false);
      // No insert happened.
      expect(await repo.findByJti('rot-new-reuse')).toBeNull();
      // The original revoke timestamp is preserved (conditional UPDATE matched 0 rows).
      const oldRow = await repo.findByJti('rot-reuse');
      expect(oldRow?.revokedAt).toEqual(new Date('2024-05-01T00:00:00Z'));
    });

    it('returns false when the jti does not exist', async () => {
      const newToken = issueToken('rot-new-unknown');
      const ok = await repo.revokeIfActiveAndSave('no-such-jti', new Date(), newToken);
      expect(ok).toBe(false);
      expect(await repo.findByJti('rot-new-unknown')).toBeNull();
    });

    it('rolls back the conditional revoke when the new-token insert violates the jti unique constraint (R2-3 atomicity)', async () => {
      // The active row whose revocation MUST roll back on insert failure.
      const oldActive = issueToken('rot-old-active');
      await repo.save(oldActive);
      // Pre-seed a row that will collide with the new token's jti.
      const collision = issueToken('rot-collision');
      await repo.save(collision);
      // New token reuses the colliding jti → insert inside the tx throws P2002.
      const newToken = issueToken('rot-collision');

      await expect(
        repo.revokeIfActiveAndSave('rot-old-active', new Date('2024-05-01T00:00:00Z'), newToken),
      ).rejects.toThrow();

      // Atomicity guarantee (R2-3): the conditional revoke was rolled back,
      // so oldActive is STILL active (not revoked).
      const survivor = await repo.findByJti('rot-old-active');
      expect(survivor?.revokedAt).toBeNull();
      expect(survivor?.isActive()).toBe(true);
    });
  });
});
