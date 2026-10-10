/** Errors raised by business rules. The HTTP layer maps `kind` to a status code. */
export abstract class DomainError extends Error {
  abstract readonly kind:
    'not_found' | 'forbidden' | 'conflict' | 'invalid_state' | 'business_rule';
}

export class NotFoundError extends DomainError {
  readonly kind = 'not_found' as const;
  constructor(entity: string) {
    super(`${entity} not found`);
  }
}

export class ForbiddenError extends DomainError {
  readonly kind = 'forbidden' as const;
  constructor(message = 'Forbidden') {
    super(message);
  }
}

export class ConflictError extends DomainError {
  readonly kind = 'conflict' as const;
}

export class InvalidStateError extends DomainError {
  readonly kind = 'invalid_state' as const;
}

export class BusinessRuleError extends DomainError {
  readonly kind = 'business_rule' as const;
}
