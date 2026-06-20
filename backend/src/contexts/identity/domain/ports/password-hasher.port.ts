/**
 * Driven port (secondary) — abstracts password hashing.
 *
 * Implemented by `ArgonPasswordHasher` (argon2id, OWASP 2025 params) in the
 * infrastructure layer.
 *
 * DESIGN §3.2: pure TS interface under `domain/ports/`.
 */
export interface PasswordHasherPort {
  hash(plain: string): Promise<string>;
  verify(plain: string, hash: string): Promise<boolean>;
}
