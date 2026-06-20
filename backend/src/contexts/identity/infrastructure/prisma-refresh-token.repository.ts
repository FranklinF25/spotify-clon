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
