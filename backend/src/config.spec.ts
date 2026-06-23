import { describe, expect, it } from 'vitest';

import { loadConfig } from './config';

const validBase = {
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/spotify_clone',
  JWT_ACCESS_SECRET: 'a'.repeat(48),
  JWT_REFRESH_SECRET: 'b'.repeat(48),
  // Required by the playback bounded context (REQ-PLAY-008, fail-fast like
  // DATABASE_URL). The e2e + unit specs never exercise the playback tree
  // from this fixture, but AppConfig rejects the whole config if the field
  // is missing — so a valid placeholder is required.
  AUDIO_STORAGE_PATH: '/tmp/playback-unused',
} as const;

describe('loadConfig', () => {
  it('boots when all required variables are valid and applies defaults', () => {
    const cfg = loadConfig(validBase);
    expect(cfg.DATABASE_URL).toBe(validBase.DATABASE_URL);
    expect(cfg.PORT).toBe(3000);
    expect(cfg.NODE_ENV).toBe('development');
  });

  it('fails fast when a required variable is missing', () => {
    const missing = {
      JWT_ACCESS_SECRET: validBase.JWT_ACCESS_SECRET,
      JWT_REFRESH_SECRET: validBase.JWT_REFRESH_SECRET,
    };
    expect(() => loadConfig(missing)).toThrowError(/Invalid environment configuration/);
    expect(() => loadConfig(missing)).toThrowError(/DATABASE_URL/);
  });

  it('fails fast when a JWT secret is too short', () => {
    expect(() => loadConfig({ ...validBase, JWT_ACCESS_SECRET: 'too-short' })).toThrowError(
      /JWT_ACCESS_SECRET/,
    );
  });

  it('applies OWASP 2025 argon2 defaults when unset', () => {
    const cfg = loadConfig(validBase);
    expect(cfg.ARGON2_MEMORY_COST).toBe(19456);
    expect(cfg.ARGON2_TIME_COST).toBe(2);
    expect(cfg.ARGON2_PARALLELISM).toBe(1);
  });

  it('parses the cookie secure flag and refresh path from env', () => {
    expect(loadConfig({ ...validBase, COOKIE_SECURE: 'true' }).COOKIE_SECURE).toBe(true);
    expect(loadConfig({ ...validBase, COOKIE_SECURE: 'false' }).COOKIE_SECURE).toBe(false);
    expect(loadConfig(validBase).REFRESH_COOKIE_PATH).toBe('/api/v1/auth');
  });

  it('defaults COOKIE_SECURE to false in development when unset', () => {
    expect(loadConfig({ ...validBase }).COOKIE_SECURE).toBe(false);
  });

  it('defaults COOKIE_SECURE to true in production when unset (spec: refresh cookie MUST be Secure in prod)', () => {
    expect(loadConfig({ ...validBase, NODE_ENV: 'production' }).COOKIE_SECURE).toBe(true);
  });

  it('fails fast when production explicitly disables COOKIE_SECURE', () => {
    expect(() =>
      loadConfig({ ...validBase, NODE_ENV: 'production', COOKIE_SECURE: 'false' }),
    ).toThrowError(/COOKIE_SECURE must be true in production/);
  });

  it('honours an explicit COOKIE_SECURE=true in production', () => {
    expect(loadConfig({ ...validBase, NODE_ENV: 'production', COOKIE_SECURE: 'true' }).COOKIE_SECURE).toBe(true);
  });
});
