import { describe, expect, it } from 'vitest';

import { DomainError } from '../../../shared/errors/domain-error';
import { ForbiddenError } from '../../../shared/errors/forbidden-error';
import { ValidationError } from '../../../shared/errors/validation-error';
import { Playlist } from './playlist.entity';

/**
 * Unit spec for the `Playlist` aggregate (F5 — design §3.1 + §14.1).
 *
 * Covers the validating factory (`create`), the mutator (`rename`), the
 * ownership invariant (`ensureOwnedBy`), the trusted hydration
 * (`reconstruct`), and the HTTP projection (`toPrimitive`).
 *
 * The title 1..100 invariant (LOCKED product #5 + design R5) is enforced
 * BOTH in `create` and `rename` so callers cannot construct or mutate into
 * an invalid state.
 */
describe('Playlist', () => {
  const NOW = new Date('2025-01-01T00:00:00.000Z');

  describe('create', () => {
    it('trims the title and sets createdAt === updatedAt on a valid input', () => {
      const playlist = Playlist.create({
        id: 'pl-1',
        userId: 'user-1',
        title: '  My Playlist  ',
        now: NOW,
      });

      expect(playlist.title).toBe('My Playlist');
      expect(playlist.createdAt).toBe(NOW);
      expect(playlist.updatedAt).toBe(NOW);
    });

    it('throws ValidationError when the title is empty (after trim)', () => {
      try {
        Playlist.create({ id: 'pl-1', userId: 'user-1', title: '   ', now: NOW });
        throw new Error('expected ValidationError');
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        expect((error as ValidationError).code).toBe('VALIDATION_ERROR');
        expect((error as ValidationError).status).toBe(400);
        expect((error as ValidationError).details).toEqual([
          { field: 'title', issue: 'invalid_length' },
        ]);
      }
    });

    it('throws ValidationError when the title exceeds 100 chars (after trim)', () => {
      const longTitle = 'x'.repeat(101);
      try {
        Playlist.create({ id: 'pl-1', userId: 'user-1', title: longTitle, now: NOW });
        throw new Error('expected ValidationError');
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        expect((error as ValidationError).details).toEqual([
          { field: 'title', issue: 'invalid_length' },
        ]);
      }
    });

    it('accepts exactly 1-char and exactly 100-char titles (boundary)', () => {
      const min = Playlist.create({ id: 'pl-1', userId: 'user-1', title: 'x', now: NOW });
      const max = Playlist.create({
        id: 'pl-2',
        userId: 'user-1',
        title: 'x'.repeat(100),
        now: NOW,
      });
      expect(min.title).toBe('x');
      expect(max.title).toHaveLength(100);
    });

    it('throws ValidationError when the title is a non-string (defensive)', () => {
      try {
        // Force-cast to simulate a malformed runtime payload.
        Playlist.create({
          id: 'pl-1',
          userId: 'user-1',
          title: 123 as unknown as string,
          now: NOW,
        });
        throw new Error('expected ValidationError');
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        expect((error as ValidationError).details?.[0]?.field).toBe('title');
      }
    });
  });

  describe('rename', () => {
    it('updates the title and bumps updatedAt when valid', () => {
      const playlist = Playlist.create({
        id: 'pl-1',
        userId: 'user-1',
        title: 'Old',
        now: NOW,
      });
      const later = new Date('2025-02-01T00:00:00.000Z');

      playlist.rename('  New Title  ', later);

      expect(playlist.title).toBe('New Title');
      expect(playlist.updatedAt).toBe(later);
      expect(playlist.createdAt).toBe(NOW);
    });

    it('throws ValidationError on empty new title', () => {
      const playlist = Playlist.create({
        id: 'pl-1',
        userId: 'user-1',
        title: 'Old',
        now: NOW,
      });
      expect(() => playlist.rename('   ', NOW)).toThrow(ValidationError);
    });

    it('throws ValidationError on >100-char new title', () => {
      const playlist = Playlist.create({
        id: 'pl-1',
        userId: 'user-1',
        title: 'Old',
        now: NOW,
      });
      expect(() => playlist.rename('x'.repeat(101), NOW)).toThrow(ValidationError);
    });
  });

  describe('ensureOwnedBy', () => {
    it('passes silently when the caller is the owner', () => {
      const playlist = Playlist.create({
        id: 'pl-1',
        userId: 'user-1',
        title: 'Mine',
        now: NOW,
      });

      expect(() => playlist.ensureOwnedBy('user-1')).not.toThrow();
    });

    it('throws ForbiddenError (code FORBIDDEN, status 403) when the caller differs', () => {
      const playlist = Playlist.create({
        id: 'pl-1',
        userId: 'user-1',
        title: 'Mine',
        now: NOW,
      });

      try {
        playlist.ensureOwnedBy('user-2');
        throw new Error('expected ForbiddenError');
      } catch (error) {
        expect(error).toBeInstanceOf(ForbiddenError);
        expect(error).toBeInstanceOf(DomainError);
        expect((error as ForbiddenError).code).toBe('FORBIDDEN');
        expect((error as ForbiddenError).status).toBe(403);
        expect((error as Error).message).toBe('playlist access forbidden: pl-1');
      }
    });
  });

  describe('reconstruct', () => {
    it('round-trips a row WITHOUT re-validating the title (DB is trusted)', () => {
      // A title that the validating factory would reject (101 chars) is
      // accepted by reconstruct — mirrors User.reconstruct's stance that the
      // persistence row was written through the factory, so re-checking would
      // mutate historically-stored values.
      const longTitle = 'x'.repeat(101);
      const earlier = new Date('2024-12-01T00:00:00.000Z');
      const later = new Date('2025-01-15T00:00:00.000Z');

      const playlist = Playlist.reconstruct({
        id: 'pl-1',
        userId: 'user-1',
        title: longTitle,
        createdAt: earlier,
        updatedAt: later,
      });

      expect(playlist.title).toBe(longTitle);
      expect(playlist.createdAt).toBe(earlier);
      expect(playlist.updatedAt).toBe(later);
    });

    it('preserves empty titles too (DB is the source of truth)', () => {
      const playlist = Playlist.reconstruct({
        id: 'pl-1',
        userId: 'user-1',
        title: '',
        createdAt: NOW,
        updatedAt: NOW,
      });

      expect(playlist.title).toBe('');
    });
  });

  describe('toPrimitive', () => {
    it('returns { id, userId, title, createdAt, updatedAt }', () => {
      const playlist = Playlist.create({
        id: 'pl-1',
        userId: 'user-1',
        title: 'My Playlist',
        now: NOW,
      });

      expect(playlist.toPrimitive()).toEqual({
        id: 'pl-1',
        userId: 'user-1',
        title: 'My Playlist',
        createdAt: NOW,
        updatedAt: NOW,
      });
    });
  });
});
