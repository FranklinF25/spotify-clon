import argon2, { type Options } from 'argon2';

import type { PasswordHasherPort } from '../domain/ports/password-hasher.port';

/**
 * Configuration for {@link ArgonPasswordHasher}. Mirrors the OWASP 2025
 * argon2id baseline (memoryCost=19456, timeCost=2, parallelism=1) but stays
 * env-tunable so operational tuning (DESIGN argon2id params) does not require a
 * code change.
 */
export interface ArgonPasswordHasherConfig {
  memoryCost: number;
  timeCost: number;
  parallelism: number;
}

/**
 * Password hashing adapter backed by the native `argon2` binding.
 *
 * Implements `PasswordHasherPort` (DESIGN §3.2 driven port) so the application
 * layer never knows which algorithm is in use. Hard-pins `argon2id` per DESIGN
 * §1.4 — argon2i / argon2d are not selectable here on purpose.
 *
 * `verify` swallows malformed-hash errors and returns `false` so callers can
 * treat "stored credential is garbage" identically to "wrong password" without
 * a try/catch at every call site.
 */
export class ArgonPasswordHasher implements PasswordHasherPort {
  private readonly options: Options;

  constructor(config: ArgonPasswordHasherConfig) {
    this.options = {
      type: argon2.argon2id,
      memoryCost: config.memoryCost,
      timeCost: config.timeCost,
      parallelism: config.parallelism,
    };
  }

  async hash(plain: string): Promise<string> {
    return argon2.hash(plain, this.options);
  }

  async verify(plain: string, hash: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      // Malformed or unsupported hash → treat as a failed verification rather
      // than leaking an exception into the use-case layer.
      return false;
    }
  }
}
