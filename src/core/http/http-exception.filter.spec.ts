import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OptimisticLockVersionMismatchError, QueryFailedError } from 'typeorm';
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  InvalidStateError,
  NotFoundError,
} from '../domain/domain-error';
import { toHttpError } from './http-exception.filter';

function pgError(code: string): QueryFailedError {
  return new QueryFailedError('SELECT 1', [], Object.assign(new Error('pg'), { code }));
}

describe('toHttpError', () => {
  it.each([
    [new NotFoundError('Application'), 404, 'Application not found'],
    [new ForbiddenError(), 403, 'Forbidden'],
    [new ConflictError('Stale version'), 409, 'Stale version'],
    [new InvalidStateError('Cannot submit'), 409, 'Cannot submit'],
    [new BusinessRuleError('Tax id required'), 422, 'Tax id required'],
    [new NotFoundException(), 404, 'Not Found'],
    [new OptimisticLockVersionMismatchError('X', 1, 2), 409, 'Resource was modified concurrently'],
    [pgError('23505'), 409, 'Conflicts with existing data'],
    [pgError('23514'), 422, 'Violates a data constraint'],
    [pgError('23503'), 422, 'Violates a data constraint'],
  ])('maps %p to %i', (error, status, message) => {
    expect(toHttpError(error)).toMatchObject({ status, message });
  });

  it('surfaces validation messages as details', () => {
    const result = toHttpError(new BadRequestException(['name must be a string']));
    expect(result).toEqual({
      status: 400,
      message: 'Validation failed',
      details: ['name must be a string'],
    });
  });

  it('hides internals of unknown errors', () => {
    expect(toHttpError(new Error('connection string postgres://secret'))).toEqual({
      status: 500,
      message: 'Internal server error',
    });
  });
});
