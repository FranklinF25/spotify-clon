import { DomainError } from './domain-error';

/**
 * Raised when a request conflicts with existing state (e.g. duplicate email).
 */
export class ConflictError extends DomainError {
  readonly code = 'CONFLICT' as const;
  readonly status = 409;

  constructor(message = 'Conflict') {
    super(message);
  }
}
