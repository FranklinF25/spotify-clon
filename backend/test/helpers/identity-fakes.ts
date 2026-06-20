import type { JwtSignerPort, AccessTokenPayload, RefreshTokenPayload } from '../../src/contexts/identity/domain/ports/jwt-signer.port';
import type { PasswordHasherPort } from '../../src/contexts/identity/domain/ports/password-hasher.port';
import type { RefreshTokenRepositoryPort } from '../../src/contexts/identity/domain/ports/refresh-token-repository.port';
import type { UserRepositoryPort } from '../../src/contexts/identity/domain/ports/user-repository.port';
import type { RefreshToken } from '../../src/contexts/identity/domain/refresh-token.entity';
import type { User } from '../../src/contexts/identity/domain/user.entity';

/**
 * Hand-written in-memory port fakes for the identity use-case specs.
 *
 * DESIGN mocking strategy (Vitest Harness Layout):
 *   "Application — hand-written in-memory fakes implementing each `*Port`
 *   (preferred over `vi.mock` for readability; fakes double as living port
 *   consumers). `vi.fn()` only when asserting call counts."
 *
 * These fakes live under `test/helpers/` so every identity application spec
 * shares the same living implementation of each port — drift between a fake
 * and the real interface surfaces as a typecheck error here first.
 */

/** In-memory user store. `save` is upsert-by-id (matches the port contract). */
export class InMemoryUserRepository implements UserRepositoryPort {
  public readonly saved: User[] = [];
  public readonly existsEmails = new Set<string>();

  async findById(id: string): Promise<User | null> {
    return this.saved.find((u) => u.id === id) ?? null;
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.saved.find((u) => u.email === email) ?? null;
  }

  async save(user: User): Promise<User> {
    const idx = this.saved.findIndex((u) => u.id === user.id);
    if (idx >= 0) {
      this.saved[idx] = user;
    } else {
      this.saved.push(user);
    }
    this.existsEmails.add(user.email);
    return user;
  }

  async existsByEmail(email: string): Promise<boolean> {
    return this.existsEmails.has(email);
  }
}

/**
 * In-memory refresh-token store. Records every `revokeAllForUser` invocation
 * (the single-session kill switch) so the LoginUseCase spec can assert it.
 *
 * `revokeIfActive` mirrors the conditional UPDATE of the Prisma repo: it
 * returns `false` when the row is missing or already revoked. Setting the
 * public `revokeIfActiveResult` field forces a specific outcome so the
 * RefreshTokenUseCase rotation-race spec can simulate the losing side of a
 * concurrent refresh without needing multiple threads.
 *
 * `revokeAllAndSave` is atomic in the same sense as the Prisma `$transaction`
 * implementation: if `save` throws (configured via `saveShouldThrow`), the
 * prior-row revocations are rolled back so the user is never left without
 * active tokens.
 *
 * `revokeIfActiveAndSave` mirrors the rotation primitive of the Prisma repo:
 * conditional revoke + new-row insert in a single logical transaction. On any
 * save failure the conditional revoke is rolled back so the user is never
 * left with zero active tokens (the rotation analogue of S4).
 */
export class InMemoryRefreshTokenRepository implements RefreshTokenRepositoryPort {
  public readonly saved: RefreshToken[] = [];
  public readonly revokedAllFor: Array<{ userId: string; exceptJti?: string }> = [];
  public readonly revokeAllAndSaveCalls: Array<{ userId: string }> = [];
  /** Force the next `revokeIfActive` / `revokeIfActiveAndSave` outcome (undefined = real behaviour). */
  public revokeIfActiveResult?: boolean;
  /** Force the next `save` to throw (used by revokeAllAndSave / revokeIfActiveAndSave atomicity tests). */
  public saveShouldThrow?: Error;

  async findByJti(jti: string): Promise<RefreshToken | null> {
    return this.saved.find((t) => t.jti === jti) ?? null;
  }

  async findActiveByUser(userId: string): Promise<RefreshToken[]> {
    const now = new Date();
    return this.saved.filter((t) => t.userId === userId && t.isActive(now));
  }

  async save(token: RefreshToken): Promise<RefreshToken> {
    if (this.saveShouldThrow) {
      const err = this.saveShouldThrow;
      this.saveShouldThrow = undefined;
      throw err;
    }
    const idx = this.saved.findIndex((t) => t.id === token.id);
    if (idx >= 0) {
      this.saved[idx] = token;
    } else {
      this.saved.push(token);
    }
    return token;
  }

  async revoke(token: RefreshToken): Promise<void> {
    token.revoke(new Date());
    await this.save(token);
  }

  async revokeAllForUser(userId: string, exceptJti?: string): Promise<void> {
    this.revokedAllFor.push({ userId, exceptJti });
    const now = new Date();
    for (const t of this.saved) {
      if (t.userId === userId && t.jti !== exceptJti) {
        t.revoke(now);
      }
    }
  }

  async revokeIfActive(jti: string, revokedAt: Date): Promise<boolean> {
    if (this.revokeIfActiveResult !== undefined) {
      const forced = this.revokeIfActiveResult;
      this.revokeIfActiveResult = undefined;
      if (forced) {
        const token = this.saved.find((t) => t.jti === jti);
        token?.revoke(revokedAt);
      }
      return forced;
    }
    const token = this.saved.find((t) => t.jti === jti);
    if (!token || token.revokedAt !== null) return false;
    token.revoke(revokedAt);
    return true;
  }

  async revokeIfActiveAndSave(
    jti: string,
    revokedAt: Date,
    newToken: RefreshToken,
  ): Promise<boolean> {
    // Snapshot the target row's revokedAt BEFORE the conditional revoke so we
    // can roll it back if the new-row save throws. Same atomicity shape as
    // `revokeAllAndSave` (S4) — the rotation analogue (R2-3).
    const target = this.saved.find((t) => t.jti === jti);
    const snapshot = target ? { token: target, revokedAt: target.revokedAt } : null;

    // Honor the forced race-loss outcome so the use-case spec can simulate
    // the losing side of a concurrent rotation.
    const forced = this.revokeIfActiveResult;
    if (forced !== undefined) {
      this.revokeIfActiveResult = undefined;
      if (!forced) return false;
    } else if (!target || target.revokedAt !== null) {
      return false;
    }

    try {
      target?.revoke(revokedAt);
      await this.save(newToken);
      return true;
    } catch (err) {
      // Roll back: restore the pre-transaction revokedAt on the target row so
      // a failed rotation never leaves the user with zero active tokens.
      if (snapshot) snapshot.token.revokedAt = snapshot.revokedAt;
      throw err;
    }
  }

  async revokeAllAndSave(userId: string, newToken: RefreshToken): Promise<void> {
    // Snapshot every row's revokedAt so we can roll back if the save throws.
    const snapshot = this.saved.map((t) => ({ token: t, revokedAt: t.revokedAt }));
    const now = newToken.issuedAt;
    try {
      for (const t of this.saved) {
        if (t.userId === userId && t.revokedAt === null) {
          t.revoke(now);
        }
      }
      await this.save(newToken);
      this.revokeAllAndSaveCalls.push({ userId });
    } catch (err) {
      // Roll back: restore the pre-transaction revokedAt on every touched row.
      for (const snap of snapshot) {
        snap.token.revokedAt = snap.revokedAt;
      }
      throw err;
    }
  }
}

/**
 * Deterministic fake hasher: `hash(p)` = `hashed(${p})`. Records every hashed
 * plain value so specs can assert "hash was called" (e.g. constant-time dummy
 * hash on unknown email).
 */
export class FakePasswordHasher implements PasswordHasherPort {
  public readonly hashed: string[] = [];

  async hash(plain: string): Promise<string> {
    this.hashed.push(plain);
    return `hashed(${plain})`;
  }

  async verify(plain: string, hash: string): Promise<boolean> {
    return hash === `hashed(${plain})`;
  }
}

/**
 * Deterministic fake JWT signer.
 *
 * - signAccessToken / signRefreshToken return opaque strings encoding the
 *   payload so specs can assert "the access token was signed with sub=X".
 * - verifyAccessToken / verifyRefreshToken return whatever the spec staged in
 *   `accessToVerify` / `refreshToVerify`, or throw if `verifyFails` is set.
 *   This lets the RefreshToken/Logout specs simulate invalid JWT, unknown jti,
 *   etc., without depending on a real JWT library.
 */
export class FakeJwtSigner implements JwtSignerPort {
  public readonly accessSigned: AccessTokenPayload[] = [];
  public readonly refreshSigned: RefreshTokenPayload[] = [];
  public refreshToVerify: RefreshTokenPayload | null = null;
  public accessToVerify: AccessTokenPayload | null = null;
  public verifyFails = false;

  async signAccessToken(payload: AccessTokenPayload): Promise<string> {
    this.accessSigned.push(payload);
    return `access(${payload.sub}:${payload.email})`;
  }

  async signRefreshToken(payload: RefreshTokenPayload): Promise<string> {
    this.refreshSigned.push(payload);
    return `refresh(${payload.sub}:${payload.jti}:${payload.email})`;
  }

  async verifyAccessToken(_token: string): Promise<AccessTokenPayload> {
    if (this.verifyFails || !this.accessToVerify) {
      throw new Error('invalid access token');
    }
    return this.accessToVerify;
  }

  async verifyRefreshToken(_token: string): Promise<RefreshTokenPayload> {
    if (this.verifyFails || !this.refreshToVerify) {
      throw new Error('invalid refresh token');
    }
    return this.refreshToVerify;
  }
}

/** Common 7-day refresh TTL constant for use-case specs. */
export const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
