import type { PrismaClient, RefreshToken as PrismaRefreshToken } from '@prisma/client';

import type { RefreshTokenRepositoryPort } from '../domain/ports/refresh-token-repository.port';
import { RefreshToken } from '../domain/refresh-token.entity';

/**
 * Prisma-backed `RefreshTokenRepositoryPort`.
 *
 * Single-session + rotation semantics (DESIGN §1.4):
 *   - `findActiveByUser` filters on `revokedAt IS NULL AND expires_at > now`,
 *   - `revokeAllForUser(userId, exceptJti?)` is the single-session kill switch
 *     fired on login (and spareable for rotation, though rotation currently
 *     revokes only the presented row),
 *   - `save` upserts by id so a `revoke()` mutation persists on the next save.
 *
 * `revoke()` follows the port contract: it stamps `revokedAt = now` on the
 * entity (idempotently — `RefreshToken.revoke` keeps the first timestamp) and
 * writes the column. Plain class, wired via `useFactory` in `AuthModule`.
 */
export class PrismaRefreshTokenRepository implements RefreshTokenRepositoryPort {
  constructor(private readonly prisma: PrismaClient) {}

  async findByJti(jti: string): Promise<RefreshToken | null> {
    const row = await this.prisma.refreshToken.findUnique({ where: { jti } });
    return row ? toDomain(row) : null;
  }

  async findActiveByUser(userId: string): Promise<RefreshToken[]> {
    const now = new Date();
    const rows = await this.prisma.refreshToken.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: now } },
    });
    return rows.map(toDomain);
  }

  async save(token: RefreshToken): Promise<RefreshToken> {
    const row = await this.prisma.refreshToken.upsert({
      where: { id: token.id },
      create: {
        id: token.id,
        userId: token.userId,
        jti: token.jti,
        issuedAt: token.issuedAt,
        expiresAt: token.expiresAt,
        revokedAt: token.revokedAt,
        createdAt: token.createdAt,
      },
      update: {
        // issuedAt/expiresAt/jti are immutable after issue; only revokedAt
        // changes (rotation/logout/login revocation).
        revokedAt: token.revokedAt,
      },
    });
    return toDomain(row);
  }

  async revoke(token: RefreshToken): Promise<void> {
    token.revoke(new Date());
    await this.prisma.refreshToken.update({
      where: { id: token.id },
      data: { revokedAt: token.revokedAt },
    });
  }

  async revokeAllForUser(userId: string, exceptJti?: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(exceptJti !== undefined ? { jti: { not: exceptJti } } : {}),
      },
      data: { revokedAt: new Date() },
    });
  }

  async revokeIfActive(jti: string, revokedAt: Date): Promise<boolean> {
    // Conditional UPDATE — only flips a still-active row. The `count` tells
    // the caller whether it won or lost the concurrent-rotation race.
    const result = await this.prisma.refreshToken.updateMany({
      where: { jti, revokedAt: null },
      data: { revokedAt },
    });
    return result.count === 1;
  }

  async revokeIfActiveAndSave(
    jti: string,
    revokedAt: Date,
    newToken: RefreshToken,
  ): Promise<boolean> {
    // Interactive $transaction: the conditional revoke and the new-row insert
    // commit together (or roll back together). If the conditional revoke
    // matches zero rows the insert is skipped and the tx returns `false`
    // (rotation reuse detected). If the insert throws (e.g. P2002 on the new
    // jti) Prisma aborts the tx and the conditional revoke is rolled back so
    // the user is never left with zero active tokens — the rotation analogue
    // of `revokeAllAndSave` (S4 / R2-3).
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.refreshToken.updateMany({
        where: { jti, revokedAt: null },
        data: { revokedAt },
      });
      if (result.count !== 1) return false;
      await tx.refreshToken.create({
        data: {
          id: newToken.id,
          userId: newToken.userId,
          jti: newToken.jti,
          issuedAt: newToken.issuedAt,
          expiresAt: newToken.expiresAt,
          revokedAt: newToken.revokedAt,
          createdAt: newToken.createdAt,
        },
      });
      return true;
    });
  }

  async revokeAllAndSave(userId: string, newToken: RefreshToken): Promise<void> {
    // Single transaction: revoke every active row for the user, then upsert
    // the freshly issued replacement. If the upsert fails (e.g. a concurrent
    // registration of the same jti) the revocations are rolled back so the
    // user is never left with zero active tokens.
    await this.prisma.$transaction([
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: newToken.issuedAt },
      }),
      this.prisma.refreshToken.upsert({
        where: { id: newToken.id },
        create: {
          id: newToken.id,
          userId: newToken.userId,
          jti: newToken.jti,
          issuedAt: newToken.issuedAt,
          expiresAt: newToken.expiresAt,
          revokedAt: newToken.revokedAt,
          createdAt: newToken.createdAt,
        },
        update: {
          revokedAt: newToken.revokedAt,
        },
      }),
    ]);
  }
}

function toDomain(row: PrismaRefreshToken): RefreshToken {
  return RefreshToken.reconstruct({
    id: row.id,
    userId: row.userId,
    jti: row.jti,
    issuedAt: row.issuedAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
  });
}
