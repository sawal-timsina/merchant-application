import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional, ApiResponse } from '@nestjs/swagger';

/** Swagger mirror of the body HttpExceptionFilter returns for every non-2xx response. */
export class ErrorResponse {
  @ApiProperty({ example: 409 }) statusCode!: number;
  @ApiProperty({ example: 'Conflict' }) error!: string;
  @ApiProperty({ example: 'Cannot submit an application in status SUBMITTED' }) message!: string;
  @ApiPropertyOptional({ type: [String], description: 'Validation messages (400 only)' })
  details?: string[];
  @ApiProperty({ example: '3f0c2a5e-6c1b-4a83-9f0e-2d1c8b7a6e54' }) requestId!: string;
}

const DESCRIPTIONS: Record<number, string> = {
  400: 'Validation failed',
  401: 'Missing or invalid credentials',
  403: 'Authenticated but not permitted',
  404: 'Not found, or not visible to the caller',
  409: 'Invalid state transition or concurrent modification',
  422: 'Business rule violated',
  429: 'Rate limit exceeded',
};

/** Documents the given error statuses with the shared ErrorResponse schema. */
export const ApiErrors = (...statuses: number[]) =>
  applyDecorators(
    ...statuses.map((status) =>
      ApiResponse({ status, description: DESCRIPTIONS[status], type: ErrorResponse }),
    ),
  );
