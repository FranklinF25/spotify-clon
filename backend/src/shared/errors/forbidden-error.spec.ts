import { describe, expect, it } from 'vitest';

import { DomainError } from './domain-error';
import { ForbiddenError } from './forbidden-error';

/**
 * Unit spec for `ForbiddenError` (F5 — first write-side context).
 *
 * Closes the vocab-vs-class gap: the `FORBIDDEN` member of `ErrorCode` has
 * existed since identity but had no class. The class lets application code
 * throw the same code without going through Nest's HttpException hierarchy.
 *
 * Spec contract (REQ-P-011): error code `FORBIDDEN`, HTTP 403.
 */
describe('ForbiddenError', () => {
  it('pins code to FORBIDDEN and status to 403', () => {
    const error = new ForbiddenError('playlist', 'pl-1');

    expect(error.code).toBe('FORBIDDEN');
    expect(error.status).toBe(403);
  });

  it('formats the message as "<entity> access forbidden: <id>"', () => {
    const error = new ForbiddenError('playlist', 'pl-1');

    expect(error.message).toBe('playlist access forbidden: pl-1');
  });

  it('is an instance of DomainError (flows through the global filter)', () => {
    const error = new ForbiddenError('playlist', 'pl-1');

    expect(error).toBeInstanceOf(DomainError);
  });

  it('serializes to the standard envelope via toJSON', () => {
    const error = new ForbiddenError('playlist', 'pl-1');

    expect(error.toJSON()).toEqual({
      code: 'FORBIDDEN',
      message: 'playlist access forbidden: pl-1',
    });
  });

  it('does not attach details (no field-level info for ownership)', () => {
    const error = new ForbiddenError('playlist', 'pl-1');

    expect(error.details).toBeUndefined();
  });
});
