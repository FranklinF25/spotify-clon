import type { PrismaClient } from '@prisma/client';

import type {
  LibraryRepositoryPort,
  UserLibraryAlbumPrimitive,
} from '../domain/ports/library-repository.port';

/**
 * Prisma adapter for the `LibraryRepositoryPort` (F6 — design §7).
 *
 * Every write is a SINGLE statement — no `$transaction` anywhere (contrast
 * with F5's three transactional methods): the upsert's atomicity is
 * structural (one statement), and `deleteMany` has no multi-row invariant
 * to protect.
 *
 *  - `addAlbum`    — upsert on the typed composite key `userId_albumId`
 *                    (falls out of `@@id`); the update branch resets
 *                    `addedAt` (LOCKED decision #3).
 *  - `removeAlbum` — `deleteMany`: 0 rows deleted is success (REQ-L-004 —
 *                    no P2002/P2025 path exists on a deleteMany).
 *  - `listByUser`  — `findMany` ordered `addedAt: 'desc'` (REQ-L-003 hot
 *                    path: the PK leads with user_id).
 */
export class PrismaLibraryRepository implements LibraryRepositoryPort {
  constructor(private readonly prisma: PrismaClient) {}

  async addAlbum(input: {
    userId: string;
    albumId: string;
    now: Date;
  }): Promise<UserLibraryAlbumPrimitive> {
    // Upsert on the typed composite key — the update branch resets added_at
    // (LOCKED decision #3: re-save moves the album to the top, always 204).
    const row = await this.prisma.userLibraryAlbum.upsert({
      where: {
        userId_albumId: { userId: input.userId, albumId: input.albumId },
      },
      create: {
        userId: input.userId,
        albumId: input.albumId,
        addedAt: input.now,
      },
      update: { addedAt: input.now },
    });
    return toRow(row);
  }

  async removeAlbum(input: { userId: string; albumId: string }): Promise<void> {
    // deleteMany = idempotent: 0 rows deleted is success (REQ-L-004).
    await this.prisma.userLibraryAlbum.deleteMany({
      where: { userId: input.userId, albumId: input.albumId },
    });
  }

  async listByUser(userId: string): Promise<UserLibraryAlbumPrimitive[]> {
    const rows = await this.prisma.userLibraryAlbum.findMany({
      where: { userId },
      orderBy: { addedAt: 'desc' },
    });
    return rows.map(toRow);
  }
}

/** Prisma row → port primitive. `userId` omitted (every consumer knows it). */
function toRow(row: { albumId: string; addedAt: Date }): UserLibraryAlbumPrimitive {
  return { albumId: row.albumId, addedAt: row.addedAt };
}
