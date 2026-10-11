import { applyDecorators, type Type as ClassType } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiOkResponse,
  ApiProperty,
  ApiPropertyOptional,
  getSchemaPath,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export class PageQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 20;
}

export class Page<T> {
  /** Typed per endpoint by {@link ApiPageResponse}. */
  @ApiProperty({ type: 'array', items: { type: 'object' } })
  items!: T[];

  @ApiProperty({ minimum: 0 }) total!: number;
  @ApiProperty({ minimum: 1 }) page!: number;
  @ApiProperty({ minimum: 1 }) pageSize!: number;
}

/**
 * Documents a `Page<model>` response. Generics are erased at runtime, so `type: Page<X>` would
 * document every page the same way; this narrows `items` to the model's schema instead.
 */
export const ApiPageResponse = (model: ClassType) =>
  applyDecorators(
    ApiExtraModels(Page, model),
    ApiOkResponse({
      schema: {
        allOf: [
          { $ref: getSchemaPath(Page) },
          { properties: { items: { type: 'array', items: { $ref: getSchemaPath(model) } } } },
        ],
      },
    }),
  );
