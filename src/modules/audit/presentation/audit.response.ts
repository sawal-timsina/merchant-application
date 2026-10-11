import { ApiProperty } from '@nestjs/swagger';
import type { AuditRecord, DecisionStatsRow } from '../domain/audit-record';

export class AuditRecordResponse implements AuditRecord {
  @ApiProperty() id!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: 'null = system actor' })
  actorId!: string | null;
  @ApiProperty({ type: String, nullable: true }) actorRole!: string | null;
  @ApiProperty({ example: 'APPLICATION_DECISION_RECORDED' }) action!: string;
  @ApiProperty({ example: 'merchant_application' }) entityType!: string;
  @ApiProperty({ type: String, nullable: true }) entityId!: string | null;
  @ApiProperty({ type: 'object', additionalProperties: true, description: 'Redacted' })
  metadata!: Record<string, unknown>;
  @ApiProperty({ type: String, nullable: true }) requestId!: string | null;
  @ApiProperty({ type: String, nullable: true }) ip!: string | null;
  @ApiProperty() createdAt!: Date;
}

export class DecisionStatsResponse implements DecisionStatsRow {
  @ApiProperty({ example: '2026-10-01', description: 'UTC day, YYYY-MM-DD' }) day!: string;
  @ApiProperty({ format: 'uuid' }) reviewerId!: string;
  @ApiProperty() approved!: number;
  @ApiProperty() rejected!: number;
  @ApiProperty() infoRequested!: number;
  @ApiProperty() total!: number;
}
