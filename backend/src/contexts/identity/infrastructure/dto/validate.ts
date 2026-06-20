import type { ZodType } from 'zod';

import { ValidationError } from '../../../../shared/errors/validation-error';

/**
 * Parse `data` against a Zod schema, throwing a `ValidationError` with
 * field-scoped `details` on failure.
 *
 * The DESIGN 4.3 validation envelope requires `details: [{ field, issue }]`,
 * so each Zod issue is mapped: `field` = the dotted path (or `(root)`), and
 * `issue` = the Zod issue code (stable machine-readable token) falling back to
 * the message. This keeps controller code free of try/parse boilerplate and
 * gives the global exception filter a consistent `VALIDATION_ERROR` shape.
 */
export function validate<T>(schema: ZodType<T>, data: unknown, message = 'Request validation failed'): T {
  const result = schema.safeParse(data);
  if (result.success) {
    return result.data;
  }
  const details = result.error.issues.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.join('.') : '(root)',
    issue: issue.code,
  }));
  throw new ValidationError(message, details);
}
