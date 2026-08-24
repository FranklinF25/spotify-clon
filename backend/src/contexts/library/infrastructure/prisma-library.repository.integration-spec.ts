import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '@prisma/client';
import { startTestDb, type TestDbContext } from '../../../../test/helpers/test-db';
import { PrismaLibraryRepository } from './prisma-library.repository';

/**
 * Integration spec for `PrismaLibraryRepository` (F6 — design §11.4).
 *
 * Boots a real Postgres 16 testcontainer via `startTestDb()`. The migration
 * `0003_library` is applied at bootstrap (lexicographic order:
 * 0000_init -> 0001_catalog -> 0002_playlists -> 0003_library) — the
 * container spinning up cleanly IS the migration-correctness check.
 * TRUNCATE between tests; `user_library_albums` is junction-first.
 *
 * Scenarios covered (design §11.4):
 *  1. REQ-L-006 — deleting a user cascades their saved albums (zero rows).
 *  2. REQ-L-006 — deleting an album cascades every saved reference (two
 *     users' rows referencing the deleted album disappear).
 *  3. REQ-L-006 — one row per (user, album) pair: upsert twice → exactly
 *     ONE row with a REFRESHED `addedAt` (PK-enforced).
 *  4. REQ-L-004 — `removeAlbum` on an absent pair resolves, table unchanged.
 *  5. REQ-L-003 — `listByUser` returns `added_at` desc (recency).
 */
describe('PrismaLibraryRepository (integration, Postgres 16 testcontainer)', () => {
  let db: TestDbContext;
  let prisma: PrismaClient;
  let repo: PrismaLibraryRepository;

  beforeAll(async () => {
    // 60s hookTimeout: testcontainers + Postgres 16 image pull / startup can
    // exceed the default 10s when many integration specs boot containers in
    // parallel (same rationale as the F5 playlists integration spec).
    db = await startTestDb();
    prisma = db.prisma;
    repo = new PrismaLibraryRepository(prisma);
  }, 60_000);

  afterAll(async () => {
    await db.cleanup();
  });

  beforeEach(async () => {
    await db.truncate();
  });

  // -------------------------------------------------------------------------
  // Seed helpers — create the FK-required rows (user, artist, album).
  // -------------------------------------------------------------------------

  async function seedUser(email: string): Promise<string> {
    const user = await prisma.user.create({
      data: { email, passwordHash: 'hash', displayName: email.split('@')[0] },
    });
    return user.id;
  }

  async function seedAlbum(title: string): Promise<string> {
    const artist = await prisma.artist.create({ data: { name: `Artist ${title}` } });
    const album = await prisma.album.create({
      data: { title, artistId: artist.id },
    });
    return album.id;
  }

  describe('REQ-L-006 relation lifecycle & cascades', () => {
    it('deleting a user cascades their saved albums', async () => {
      const u1 = await seedUser('u1@example.com');
      const a1 = await seedAlbum('Album One');
      const a2 = await seedAlbum('Album Two');
      const now = new Date('2025-06-01T00:00:00.000Z');
      await repo.addAlbum({ userId: u1, albumId: a1, now });
      await repo.addAlbum({ userId: u1, albumId: a2, now });

      await prisma.user.delete({ where: { id: u1 } });

      expect(
        await prisma.userLibraryAlbum.count({ where: { userId: u1 } }),
      ).toBe(0);
    });

    it('deleting an album cascades every saved reference (both users)', async () => {
      const u1 = await seedUser('u1@example.com');
      const u2 = await seedUser('u2@example.com');
      const a1 = await seedAlbum('Album One');
      const now = new Date('2025-06-01T00:00:00.000Z');
      await repo.addAlbum({ userId: u1, albumId: a1, now });
      await repo.addAlbum({ userId: u2, albumId: a1, now });

      await prisma.album.delete({ where: { id: a1 } });

      expect(
        await prisma.userLibraryAlbum.count({ where: { albumId: a1 } }),
      ).toBe(0);
    });

    it('upserting the same pair twice leaves exactly ONE row with a refreshed addedAt', async () => {
      const u1 = await seedUser('u1@example.com');
      const a1 = await seedAlbum('Album One');
      const first = new Date('2025-06-01T00:00:00.000Z');
      const second = new Date('2025-07-01T00:00:00.000Z');

      await repo.addAlbum({ userId: u1, albumId: a1, now: first });
      await repo.addAlbum({ userId: u1, albumId: a1, now: second });

      expect(await prisma.userLibraryAlbum.count()).toBe(1);
      const row = await prisma.userLibraryAlbum.findUnique({
        where: { userId_albumId: { userId: u1, albumId: a1 } },
      });
      expect(row).not.toBeNull();
      expect(row!.addedAt.toISOString()).toBe(second.toISOString());
    });
  });

  describe('REQ-L-004 idempotent remove', () => {
    it('removeAlbum on an absent pair resolves and changes nothing', async () => {
      const u1 = await seedUser('u1@example.com');
      const a1 = await seedAlbum('Album One');
      const countBefore = await prisma.userLibraryAlbum.count();

      await expect(
        repo.removeAlbum({ userId: u1, albumId: a1 }),
      ).resolves.toBeUndefined();

      expect(await prisma.userLibraryAlbum.count()).toBe(countBefore);
    });

    it('removeAlbum deletes only the caller row of a shared pair', async () => {
      const u1 = await seedUser('u1@example.com');
      const u2 = await seedUser('u2@example.com');
      const a1 = await seedAlbum('Album One');
      const now = new Date('2025-06-01T00:00:00.000Z');
      await repo.addAlbum({ userId: u1, albumId: a1, now });
      await repo.addAlbum({ userId: u2, albumId: a1, now });

      await repo.removeAlbum({ userId: u1, albumId: a1 });

      expect(
        await prisma.userLibraryAlbum.count({ where: { userId: u1 } }),
      ).toBe(0);
      expect(
        await prisma.userLibraryAlbum.count({ where: { userId: u2 } }),
      ).toBe(1);
    });
  });

  describe('REQ-L-003 recency ordering', () => {
    it('listByUser returns rows ordered added_at desc', async () => {
      const u1 = await seedUser('u1@example.com');
      const a1 = await seedAlbum('Album One');
      const a2 = await seedAlbum('Album Two');
      const a3 = await seedAlbum('Album Three');

      await repo.addAlbum({ userId: u1, albumId: a1, now: new Date('2025-06-01T00:00:00.000Z') });
      await repo.addAlbum({ userId: u1, albumId: a2, now: new Date('2025-06-02T00:00:00.000Z') });
      await repo.addAlbum({ userId: u1, albumId: a3, now: new Date('2025-06-03T00:00:00.000Z') });

      const rows = await repo.listByUser(u1);

      expect(rows.map((r) => r.albumId)).toEqual([a3, a2, a1]);
      expect(rows[0]).toEqual({ albumId: a3, addedAt: new Date('2025-06-03T00:00:00.000Z') });
    });

    it('listByUser returns [] for a user with no rows', async () => {
      const u1 = await seedUser('u1@example.com');

      expect(await repo.listByUser(u1)).toEqual([]);
    });
  });
});
