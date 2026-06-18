import { DomainError } from './domain-error';

/**
 * Raised when authentication is missing or invalid.
 *
 * The message is intentionally generic so callers cannot distinguish a wrong
 * password from an unknown account (spec: "no user enumeration").
 */
export class UnauthorizedError extends DomainError {
  readonly code = 'UNAUTHORIZED' as const;
  readonly status = 401;

  constructor(message = 'Unauthorized') {
    super(message);
  }
}
