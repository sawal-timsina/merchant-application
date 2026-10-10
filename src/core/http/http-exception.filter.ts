import { STATUS_CODES } from 'node:http';
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { OptimisticLockVersionMismatchError, QueryFailedError } from 'typeorm';
import { DomainError } from '../domain/domain-error';
import { RequestContext } from '../request-context/request-context';

const DOMAIN_STATUS: Record<DomainError['kind'], number> = {
  not_found: 404,
  forbidden: 403,
  conflict: 409,
  invalid_state: 409,
  business_rule: 422,
};

export function toHttpError(exception: unknown): {
  status: number;
  message: string;
  details?: unknown;
} {
  if (exception instanceof DomainError) {
    return { status: DOMAIN_STATUS[exception.kind], message: exception.message };
  }
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const body = exception.getResponse();
    if (
      typeof body === 'object' &&
      body !== null &&
      Array.isArray((body as { message?: unknown }).message)
    ) {
      return {
        status,
        message: 'Validation failed',
        details: (body as { message: unknown[] }).message,
      };
    }
    return { status, message: exception.message };
  }
  if (exception instanceof OptimisticLockVersionMismatchError) {
    return { status: 409, message: 'Resource was modified concurrently' };
  }
  if (exception instanceof QueryFailedError) {
    const code = (exception.driverError as { code?: string }).code;
    if (code === '23505') return { status: 409, message: 'Conflicts with existing data' };
    if (code === '23514' || code === '23503' || code === '22P02') {
      return { status: 422, message: 'Violates a data constraint' };
    }
  }
  return { status: 500, message: 'Internal server error' };
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const { status, message, details } = toHttpError(exception);
    if (status >= 500) this.logger.error(exception);
    response.status(status).json({
      statusCode: status,
      error: STATUS_CODES[status],
      message,
      ...(details === undefined ? {} : { details }),
      requestId: RequestContext.get()?.requestId ?? null,
    });
  }
}
