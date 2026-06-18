import { type ErrorDetail, DomainError } from './domain-error';

/**
 * Raised when a request payload fails input validation.
 *
 * Carries field-level `details` so the client can map each issue back to a
 * form field (DESIGN §4.3 validation envelope).
 */
export class ValidationError extends DomainError {
  readonly code = 'VALIDATION_ERROR' as const;
  readonly status = 400;

  constructor(message: string, details: ErrorDetail[]) {
    super(message, details);
  }
}
