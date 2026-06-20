import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { TestDbContext } from '../../../../test/helpers/test-db';
import { startTestDb } from '../../../../test/helpers/test-db';
import { User } from '../domain/user.entity';
import { PrismaUserRepository } from './prisma-user.repository';

/**
 * PrismaUserRepository integration — real Postgres 16 via testcontainers.
 *
 * Pins the `UserRepositoryPort` contract against the actual schema (unique
 * email, gen_random_uuid, TIMESTAMPTZ) so mapper bugs and SQL drift surface
 * here, not in the e2e flow. One container per file; TRUNCATE between tests.
 */
describe('PrismaUserRepository', () => {
  let db: TestDbContext;
  let prisma: PrismaClient;
  let repo: PrismaUserRepository;

  beforeAll(async () => {
    db = await startTestDb();
    prisma = db.prisma;
    repo = new PrismaUserRepository(prisma);
  }, 60_000);

  beforeEach(async () => {
    await db.truncate();
  });

  afterAll(async () => {
    await db.cleanup();
  });

  const seedUser = (overrides: Partial<Parameters<typeof User.register>[0]> = {}) =>
    User.register({
      id: crypto.randomUUID(),
      email: 'alice@example.com',
      passwordHash: 'argon2id$hash',
      displayName: 'Alice',
      now: new Date('2024-01-01T00:00:00Z'),
      ...overrides,
    });

  describe('save (insert)', () => {
    it('persists a new user and round-trips every field', async () => {
      const user = seedUser();

      const saved = await repo.save(user);

      expect(saved.id).toBe(user.id);
      expect(saved.email).toBe('alice@example.com');
      expect(saved.passwordHash).toBe('argon2id$hash');
      expect(saved.displayName).toBe('Alice');
    });

    it('writes exactly one row', async () => {
      await repo.save(seedUser());

      expect(await prisma.user.count()).toBe(1);
    });
  });

  describe('save (update / upsert by id)', () => {
    it('updates an existing user in place when the id matches', async () => {
      const user = seedUser();
      await repo.save(user);
      user.rename('Alice Smith', new Date('2024-03-01T00:00:00Z'));

      await repo.save(user);

      const reloaded = await repo.findById(user.id);
      expect(reloaded?.displayName).toBe('Alice Smith');
      expect(await prisma.user.count()).toBe(1);
    });
  });

  describe('findById', () => {
    it('returns the user when found', async () => {
      const user = seedUser();
      await repo.save(user);

      const found = await repo.findById(user.id);

      expect(found?.toPrimitive()).toEqual({
        id: user.id,
        email: 'alice@example.com',
        displayName: 'Alice',
      });
    });

    it('returns null for an unknown id', async () => {
      expect(await repo.findById('00000000-0000-0000-0000-000000000000')).toBeNull();
    });
  });

  describe('findByEmail', () => {
    it('returns the user matching the email', async () => {
      await repo.save(seedUser({ email: 'bob@example.com' }));

      const found = await repo.findByEmail('bob@example.com');

      expect(found?.email).toBe('bob@example.com');
      expect(found?.passwordHash).toBe('argon2id$hash');
    });

    it('returns null when no user has the email', async () => {
      expect(await repo.findByEmail('nobody@example.com')).toBeNull();
    });

    it('is case-sensitive (the domain already lowercases on register)', async () => {
      await repo.save(seedUser({ email: 'carol@example.com' }));

      // The DB stores exactly what the domain produced (lowercase). A
      // differently-cased lookup must NOT match — this proves the repository
      // does not silently normalize, deferring that to the domain layer.
      expect(await repo.findByEmail('Carol@Example.com')).toBeNull();
    });
  });

  describe('existsByEmail', () => {
    it('is false before the user exists', async () => {
      expect(await repo.existsByEmail('dave@example.com')).toBe(false);
    });

    it('is true after the user is saved', async () => {
      await repo.save(seedUser({ email: 'dave@example.com' }));

      expect(await repo.existsByEmail('dave@example.com')).toBe(true);
    });
  });

  describe('unique constraint', () => {
    it('rejects a second user with a duplicate email', async () => {
      await repo.save(seedUser({ id: crypto.randomUUID(), email: 'dup@example.com' }));

      await expect(
        repo.save(seedUser({ id: crypto.randomUUID(), email: 'dup@example.com' })),
      ).rejects.toThrow();
    });
  });
});
