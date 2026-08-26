import { ArgumentsHost } from '@nestjs/common';
import { MulterError } from 'multer';
import { describe, expect, it, vi } from 'vitest';

import { ValidationError } from '../../../shared/errors/validation-error';
import { MAX_UPLOAD_BYTES, UPLOAD_FILE_OPTIONS } from './catalog.controller';
import { UploadFileExceptionFilter } from './upload-file-exception.filter';

/**
 * Upload pipeline validation specs (REQ-UPLOAD-003 matrix — unit half).
 *
 * Three concerns, all pinned to 400 VALIDATION_ERROR with `details` on
 * field `file`:
 *  - `UploadFileExceptionFilter` translates multer failures
 *    (`LIMIT_FILE_SIZE` for oversize, any other MulterError code) into
 *    `ValidationError`s the global filter can envelope;
 *  - `UPLOAD_FILE_OPTIONS.fileFilter` rejects non-audio extensions with a
 *    `ValidationError` naming the allowlist (the multer callback contract:
 *    error-first, never the silent `callback(null, false)` drop);
 *  - `UPLOAD_FILE_OPTIONS` keeps the memory storage + the 150 MB cap the
 *    contract documents (pinning the interceptor options guards against an
 *    accidental config regression that the e2e matrix would only catch at
 *    150 MB of traffic).
 *
 * The no-file and happy-path branches of the matrix live in
 * `catalog.controller.spec.ts`; the full HTTP-level matrix (including a
 * real oversize rejection) is exercised end-to-end in
 * `test/e2e/upload.e2e-spec.ts`.
 */

/** Build the (unused) ArgumentsHost the filter signature demands. */
function host(): ArgumentsHost {
  return { switchToHttp: () => ({ getResponse: () => ({}), getRequest: () => ({}) }) } as unknown as ArgumentsHost;
}

describe('UploadFileExceptionFilter', () => {
  const filter = new UploadFileExceptionFilter();

  it('maps LIMIT_FILE_SIZE to VALIDATION_ERROR with the size cap on field "file"', () => {
    const oversize = new MulterError('LIMIT_FILE_SIZE', 'file');

    expect(() => filter.catch(oversize, host())).toThrow(ValidationError);
    try {
      filter.catch(oversize, host());
      expect.unreachable('filter must throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect(err).toMatchObject({
        code: 'VALIDATION_ERROR',
        status: 400,
        details: [{ field: 'file', issue: expect.stringContaining('150 MB') }],
      });
    }
  });

  it('maps any other MulterError (e.g. LIMIT_UNEXPECTED_FILE) to VALIDATION_ERROR on field "file"', () => {
    const unexpected = new MulterError('LIMIT_UNEXPECTED_FILE', 'not-file');

    try {
      filter.catch(unexpected, host());
      expect.unreachable('filter must throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect(err).toMatchObject({
        code: 'VALIDATION_ERROR',
        status: 400,
        details: [{ field: 'file', issue: expect.any(String) }],
      });
    }
  });
});

describe('UPLOAD_FILE_OPTIONS (multer interceptor config)', () => {
  it('uses memory storage with the 150 MB cap', () => {
    expect(UPLOAD_FILE_OPTIONS.limits).toEqual({ fileSize: MAX_UPLOAD_BYTES });
    expect(MAX_UPLOAD_BYTES).toBe(150 * 1024 * 1024);
    // memoryStorage() has no identity to assert on — assert the option is
    // present (a disk-storage regression would set `dest` instead).
    expect(UPLOAD_FILE_OPTIONS.storage).toBeDefined();
    expect(UPLOAD_FILE_OPTIONS).not.toHaveProperty('dest');
  });

  it('fileFilter accepts an audio extension case-insensitively', () => {
    const accepted: Array<[string, string]> = [
      ['a.mp3', 'audio/mpeg'],
      ['A.MP3', 'audio/mpeg'],
      ['b.flac', 'audio/flac'],
      ['c.Opus', 'audio/ogg'],
    ];
    for (const [name, mime] of accepted) {
      const callback = vi.fn();
      UPLOAD_FILE_OPTIONS.fileFilter!({} as never, { originalname: name, mimetype: mime } as never, callback);
      expect(callback, name).toHaveBeenCalledWith(null, true);
    }
  });

  it('fileFilter rejects a non-audio extension with a ValidationError naming the allowlist', () => {
    const callback = vi.fn();
    UPLOAD_FILE_OPTIONS.fileFilter!({} as never, { originalname: 'notes.txt', mimetype: 'text/plain' } as never, callback);

    expect(callback).toHaveBeenCalledTimes(1);
    const err = callback.mock.calls[0]![0];
    expect(err).toBeInstanceOf(ValidationError);
    expect(err).toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 400,
      details: [{ field: 'file', issue: expect.stringContaining('.mp3') }],
    });
    expect(callback.mock.calls[0]![1]).toBe(false);
  });
});
