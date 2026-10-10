import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PageQueryDto } from '../../../core/http/pagination';
import {
  ApplicationStatus,
  BusinessType,
  ReviewDecisionType,
  TaxIdType,
} from '../domain/application.enums';

const MAX_CENTS = Number.MAX_SAFE_INTEGER;

export class CreateApplicationDto {
  @ApiProperty() @IsString() @Length(1, 200) businessName!: string;
  @ApiProperty() @IsString() @Length(1, 200) legalBusinessName!: string;
  @ApiProperty({ enum: BusinessType }) @IsEnum(BusinessType) businessType!: BusinessType;
  @ApiProperty() @IsString() @Length(1, 200) ownerFullName!: string;
  @ApiProperty() @IsEmail() @MaxLength(320) ownerEmail!: string;

  @ApiProperty({ example: '+9779800000000', description: 'E.164' })
  @Matches(/^\+[1-9]\d{6,14}$/, { message: 'ownerPhone must be E.164, e.g. +9779800000000' })
  ownerPhone!: string;

  @ApiPropertyOptional({ example: '5812', description: 'ISO 18245 merchant category code' })
  @IsOptional()
  @Matches(/^\d{4}$/)
  mcc?: string;

  @ApiProperty({ example: 2_500_000 })
  @IsInt()
  @IsPositive()
  @Max(MAX_CENTS)
  expectedMonthlyVolumeCents!: number;

  @ApiProperty({ example: 1_500 })
  @IsInt()
  @IsPositive()
  @Max(MAX_CENTS)
  averageTicketCents!: number;

  @ApiProperty({ example: 'NPR' }) @Matches(/^[A-Z]{3}$/) currency!: string;

  @ApiPropertyOptional({ enum: TaxIdType })
  @IsOptional()
  @IsEnum(TaxIdType)
  taxIdType?: TaxIdType;

  @ApiPropertyOptional({
    description: 'Write-only. Stored encrypted; responses show only the last 4 characters.',
  })
  @IsOptional()
  @Matches(/^[A-Za-z0-9-]{4,32}$/)
  taxId?: string;
}

// skipNullProperties: false → an explicit null is validated (and rejected) rather than skipped,
// so `{ "businessName": null }` is a 400 instead of reaching a NOT NULL column.
export class UpdateApplicationDto extends PartialType(CreateApplicationDto, {
  skipNullProperties: false,
}) {
  @ApiProperty({ description: 'Version from the last read (optimistic locking)' })
  @IsInt()
  @Min(1)
  version!: number;
}

export class ListApplicationsQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: ApplicationStatus })
  @IsOptional()
  @IsEnum(ApplicationStatus)
  status?: ApplicationStatus;
}

export class AssignReviewerDto {
  @ApiProperty() @IsUUID() reviewerId!: string;
}

export class DecisionDto {
  @ApiProperty({ enum: ReviewDecisionType })
  @IsEnum(ReviewDecisionType)
  decision!: ReviewDecisionType;

  @ApiPropertyOptional({ description: 'Required for REJECT and REQUEST_INFO (10–2000 chars)' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}
