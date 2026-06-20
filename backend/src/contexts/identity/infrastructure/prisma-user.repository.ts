import type { PrismaClient, User as PrismaUser } from '@prisma/client';

import type { UserRepositoryPort } from '../domain/ports/user-repository.port';
import { User } from '../domain/user.entity';

/**
 * Prisma-backed `UserRepositoryPort`.
 *
 * Mapping: the domain `User` aggregate ⇄ the `users` row. Hydration goes through
 * `User.reconstruct` (no re-validation — the row is the trusted source). `save`
 * is an upsert by `id` so both insert (register) and update (rename) share one
 * code path.
 *
 * `updated_at` is declared `@updatedAt` on the Prisma schema, so Prisma
 * auto-stamps it on update; the repository therefore does not pass the
 * domain's `updatedAt` on the update branch and reads whatever the DB owns on
 * the way back. The DB is the source of truth for that timestamp.
 *
 * Plain class (no `@Injectable`) — wired through a `useFactory` in `AuthModule`
 * so it stays constructible and testable without a Nest `TestingModule`.
 */
export class PrismaUserRepository implements UserRepositoryPort {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<User | null> {
    const row = await this.prisma.user.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const row = await this.prisma.user.findUnique({ where: { email } });
    return row ? toDomain(row) : null;
  }

  async save(user: User): Promise<User> {
    const row = await this.prisma.user.upsert({
      where: { id: user.id },
      create: {
        id: user.id,
        email: user.email,
        passwordHash: user.passwordHash,
        displayName: user.displayName,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
      update: {
        email: user.email,
        passwordHash: user.passwordHash,
        displayName: user.displayName,
        // updatedAt is @updatedAt — Prisma stamps it automatically.
      },
    });
    return toDomain(row);
  }

  async existsByEmail(email: string): Promise<boolean> {
    const count = await this.prisma.user.count({ where: { email } });
    return count > 0;
  }
}

function toDomain(row: PrismaUser): User {
  return User.reconstruct({
    id: row.id,
    email: row.email,
    passwordHash: row.passwordHash,
    displayName: row.displayName,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}
