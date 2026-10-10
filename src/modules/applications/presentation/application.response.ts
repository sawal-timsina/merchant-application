import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { MerchantApplication } from '../infrastructure/persistence/merchant-application.entity';

export class ApplicationResponse {
  @ApiProperty() id!: string;
  @ApiProperty() businessName!: string;
  @ApiProperty() legalBusinessName!: string;
  @ApiProperty() businessType!: string;
  @ApiProperty() ownerFullName!: string;
  @ApiProperty() ownerEmail!: string;
  @ApiProperty() ownerPhone!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) mcc!: string | null;
  @ApiProperty() expectedMonthlyVolumeCents!: number;
  @ApiProperty() averageTicketCents!: number;
  @ApiProperty() currency!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) taxIdType!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) taxIdLast4!: string | null;
  @ApiProperty() status!: string;
  @ApiProperty() riskStatus!: string;
  @ApiProperty() createdById!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) assignedReviewerId!: string | null;
  @ApiProperty() submissionVersion!: number;
  @ApiProperty() version!: number;
  @ApiPropertyOptional({ type: Date, nullable: true }) submittedAt!: Date | null;
  @ApiPropertyOptional({ type: Date, nullable: true }) decidedAt!: Date | null;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}

/** Explicit allow-list: new entity columns are never exposed by accident. */
export function toApplicationResponse(e: MerchantApplication): ApplicationResponse {
  return {
    id: e.id,
    businessName: e.businessName,
    legalBusinessName: e.legalBusinessName,
    businessType: e.businessType,
    ownerFullName: e.ownerFullName,
    ownerEmail: e.ownerEmail,
    ownerPhone: e.ownerPhone,
    mcc: e.mcc,
    expectedMonthlyVolumeCents: e.expectedMonthlyVolumeCents,
    averageTicketCents: e.averageTicketCents,
    currency: e.currency,
    taxIdType: e.taxIdType,
    taxIdLast4: e.taxIdLast4,
    status: e.status,
    riskStatus: e.riskStatus,
    createdById: e.createdById,
    assignedReviewerId: e.assignedReviewerId,
    submissionVersion: e.submissionVersion,
    version: e.version,
    submittedAt: e.submittedAt,
    decidedAt: e.decidedAt,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}
