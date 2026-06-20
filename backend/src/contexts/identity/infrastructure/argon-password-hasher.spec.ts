import argon2 from 'argon2';
import { describe, expect, it } from 'vitest';

import { ArgonPasswordHasher } from './argon-password-hasher';

/**
 * ArgonPasswordHasher — adapter for `PasswordHasherPort` using argon2id with
 * the OWASP 2025 baseline (m=19456, t=2, p=1).
 *
 * These are real-library round-trip tests (no DB). They pin the contract the
 * application layer relies on: hash is opaque + verifiable, wrong passwords
 * fail, and the algorithm/params match DESIGN (argon2id, OWASP 2025).
 */
describe('ArgonPasswordHasher', () => {
  const hasher = new ArgonPasswordHasher({
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });

  describe('hash', () => {
    it('produces an argon2id hash distinct from the plain password', async () => {
      const hash = await hasher.hash('correct horse battery staple');

      expect(hash).not.toBe('correct horse battery staple');
      // argon2id encoded hashes start with the argon2id variant marker.
      expect(hash.startsWith('$argon2id$')).toBe(true);
    });

    it('salts so the same password yields distinct hashes', async () => {
      const a = await hasher.hash('same-password-x');
      const b = await hasher.hash('same-password-x');

      expect(a).not.toBe(b);
    });
  });

  describe('verify', () => {
    it('accepts the correct password against its hash', async () => {
      const hash = await hasher.hash('hunter2-long-enough');

      await expect(hasher.verify('hunter2-long-enough', hash)).resolves.toBe(true);
    });

    it('rejects a wrong password', async () => {
      const hash = await hasher.hash('hunter2-long-enough');

      await expect(hasher.verify('a-completely-different-password', hash)).resolves.toBe(false);
    });

    it('returns false (never throws) when the stored hash is malformed', async () => {
      await expect(hasher.verify('whatever', 'not-a-real-argon2-hash')).resolves.toBe(false);
    });
  });

  describe('OWASP 2025 params', () => {
    it('encodes the configured memory/time/parallelism in the produced hash', async () => {
      // m=19456, t=2, p=1 → the encoded hash preamble is
      // `$argon2id$v=19$m=19456,t=2,p=1$...`
      const hash = await hasher.hash('param-probe-password');

      expect(hash).toMatch(/\$argon2id\$v=\d+\$m=19456,t=2,p=1\$/);
    });

    it('honours overridden params (smaller cost for faster tests)', async () => {
      const cheap = new ArgonPasswordHasher({
        memoryCost: 4096,
        timeCost: 1,
        parallelism: 1,
      });
      const hash = await cheap.hash('cheap-probe');

      expect(hash).toMatch(/\$argon2id\$v=\d+\$m=4096,t=1,p=1\$/);
      // Verify still works with overridden params (argon2 reads params from hash).
      await expect(cheap.verify('cheap-probe', hash)).resolves.toBe(true);
    });
  });

  it('cross-checks against the raw argon2 library so a future swap is detectable', async () => {
    const hash = await hasher.hash('interop-password');
    // The adapter must produce hashes the underlying library accepts.
    await expect(argon2.verify(hash, 'interop-password')).resolves.toBe(true);
  });
});
