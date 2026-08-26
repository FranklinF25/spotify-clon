import { type ArgumentsHost, Catch, type ExceptionFilter } from '@nestjs/common';
import { MulterError } from 'multer';

import { ValidationError } from '../../../shared/errors/validation-error';

/**
 * Route-scoped exception filter for `POST /tracks/upload`
 * (REQ-UPLOAD-003 error contract).
 *
 * Multer's own failures arrive as `MulterError` — most importantly
 * `LIMIT_FILE_SIZE`, raised by the `limits.fileSize` cap in the
 * `FileInterceptor` options. Without this filter a `MulterError` matches
 * neither `DomainError` nor `HttpException`, so the global filter would
 * degrade it to a 500 `INTERNAL_ERROR` — the wrong bucket for a client
 * input problem. The upload contract pins ALL client-side upload failures
 * to 400 `VALIDATION_ERROR` with `details` on the `file` field.
 *
 * Mapped cases (multer error.code → issue text):
 *  - `LIMIT_FILE_SIZE`        → file exceeds the upload size limit
 *  - anything else (e.g.
 *    `LIMIT_UNEXPECTED_FILE`) → the multer message, still on field `file`
 *
 * Translation strategy: `throw` the mapped `ValidationError` OUT of
 * `catch()`. NestJS treats an exception thrown from a filter as a NEW
 * exception and re-runs filter resolution — the global
 * `GlobalExceptionFilter` then serializes the canonical
 * `{ error: { code: 'VALIDATION_ERROR', message, details } }` envelope.
 * Re-throwing keeps this filter a pure translator with zero
 * response-writing duplication.
 *
 * Non-`MulterError` exceptions NEVER reach this filter (`@Catch` scopes it
 * to `MulterError` only) — they pass straight to the global filter, so
 * `ValidationError`s raised by the fileFilter (extension allowlist) and the
 * controller (missing file part) keep their own envelope.
 */
@Catch(MulterError)
export class UploadFileExceptionFilter implements ExceptionFilter {
  catch(exception: MulterError, _host: ArgumentsHost): void {
    if (exception.code === 'LIMIT_FILE_SIZE') {
      throw new ValidationError('Uploaded file is too large', [
        { field: 'file', issue: 'file exceeds the 150 MB upload limit' },
      ]);
    }
    throw new ValidationError('File upload was rejected', [
      { field: 'file', issue: exception.message },
    ]);
  }
}
