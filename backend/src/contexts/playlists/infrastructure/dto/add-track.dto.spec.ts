import { describe, expect, it } from 'vitest';

import { ValidationError } from '../../../../shared/errors/validation-error';
import { addTrackSchema, parseAddTrackBody } from './add-track.dto';

/**
 * Add-track DTO specs (F5 — REQ-P-007, WORK-PR2-01).
 *
 * The schema enforces a well-formed UUID `trackId` at the HTTP edge. A
 * well-formed-but-unresolvable UUID (e.g. one that does not match any catalog
 * row) is the 422 case — that is the use case's job (`UnprocessableEntityError`
 * after `findTrackByIds` returns 0). The DTO only catches the malformed-payload
 * cases (missing / wrong type / non-UUID shape) → 400 VALIDATION_ERROR.
 */
describe('addTrackSchema / parseAddTrackBody', () => {
  const VALID_UUID = '00000000-0000-0000-0000-0000000000a1';

  describe('parseAddTrackBody (wrapper)', () => {
    it('returns the parsed trackId on a happy UUID parse', () => {
      expect(parseAddTrackBody({ trackId: VALID_UUID })).toEqual({ trackId: VALID_UUID });
    });

    it('rejects a missing trackId as VALIDATION_ERROR referencing trackId', () => {
      expect(() => parseAddTrackBody({})).toThrowError(ValidationError);
      try {
        parseAddTrackBody({});
      } catch (err) {
        expect((err as ValidationError).details.some((d) => d.field === 'trackId')).toBe(true);
      }
    });

    it('rejects a non-UUID trackId as VALIDATION_ERROR', () => {
      expect(() => parseAddTrackBody({ trackId: 'not-a-uuid' })).toThrowError(ValidationError);
    });

    it('rejects a non-string trackId as VALIDATION_ERROR', () => {
      expect(() => parseAddTrackBody({ trackId: 42 })).toThrowError(ValidationError);
    });
  });

  describe('addTrackSchema (raw zod)', () => {
    it('safeParse returns success for a valid UUID', () => {
      expect(addTrackSchema.safeParse({ trackId: VALID_UUID }).success).toBe(true);
    });

    it('safeParse returns failure for a malformed string', () => {
      expect(addTrackSchema.safeParse({ trackId: 'nope' }).success).toBe(false);
    });
  });
});
