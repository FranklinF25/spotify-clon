import { describe, expect, it } from 'vitest';

import { DomainError } from './domain-error';
import { UnprocessableEntityError } from './unprocessable-entity-error';

/**
 * Unit spec for `UnprocessableEntityError` (F5 — design R1).
 *
 * REQ-P-007 scenario "Unknown trackId is rejected with 422" pins HTTP 422,
 * but the existing `ErrorCode` vocabulary had no 422 member. This class +
 * the additive vocab member close that gap. Distinct from ValidationError
 * (400, malformed payload) and NotFoundError (404, addressed resource missing).
 */
describe('UnprocessableEntityError', () => {
  it('pins code to UNPROCESSABLE_ENTITY and status to 422', () => {
    const error = new UnprocessableEntityError('track', 'track-99');

    expect(error.code).toBe('UNPROCESSABLE_ENTITY');
    expect(error.status).toBe(422);
  });

  it('formats the message as "<entity> not found: <id>"', () => {
    const error = new UnprocessableEntityError('track', 'track-99');

    expect(error.message).toBe('track not found: track-99');
  });

  it('is an instance of DomainError (flows through the global filter)', () => {
    const error = new UnprocessableEntityError('track', 'track-99');

    expect(error).toBeInstanceOf(DomainError);
  });

  it('serializes to the standard envelope via toJSON', () => {
    const error = new UnprocessableEntityError('track', 'track-99');

    expect(error.toJSON()).toEqual({
      code: 'UNPROCESSABLE_ENTITY',
      message: 'track not found: track-99',
    });
  });

  it('does not attach details (no field-level info for unresolved references)', () => {
    const error = new UnprocessableEntityError('track', 'track-99');

    expect(error.details).toBeUndefined();
  });
});
