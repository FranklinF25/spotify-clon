import type { User } from '../user.entity';

/**
 * Driven port (secondary) — abstracts persistence of `User` aggregates.
 *
 * Implemented by `PrismaUserRepository` in the infrastructure layer. The
 * application layer programs against this interface so use cases stay
 * framework-agnostic and testable with in-memory fakes.
 *
 * DESIGN §3.2: pure TS interface under `domain/ports/`.
 */
export interface UserRepositoryPort {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  /** Insert or update (upsert by id). */
  save(user: User): Promise<User>;
  existsByEmail(email: string): Promise<boolean>;
}
