import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { redact } from '../../../core/redaction/redact';
import { RiskStatus } from '../../applications/domain/application.enums';
import { ApplicationEvent, nextStatus } from '../../applications/domain/application-state-machine';
import { MerchantApplication } from '../../applications/infrastructure/persistence/merchant-application.entity';
import { AuditService } from '../../audit/application/audit.service';
import { AuditAction } from '../../audit/domain/audit-action';
import { RiskAssessmentStatus } from '../domain/risk.enums';
import { type KybResult, scoreApplication } from '../domain/risk-scoring';
import { RiskAssessment } from '../infrastructure/persistence/risk-assessment.entity';

/**
 * Writes a KYB result: score, assessment, status transition and audit, atomically. Shared by the
 * worker (sync mode) and the webhook (callback mode). The caller must hold the application row
 * lock and have checked that the submission is still current.
 */
@Injectable()
export class RiskAssessmentCompleter {
  constructor(private readonly audit: AuditService) {}

  async complete(
    manager: EntityManager,
    input: {
      application: MerchantApplication;
      assessmentId: string;
      kyb: KybResult;
      correlationId: string | null;
    },
  ): Promise<void> {
    const { application, kyb } = input;
    const result = scoreApplication(application, kyb);
    const completion: Partial<RiskAssessment> = {
      status: RiskAssessmentStatus.COMPLETED,
      score: result.score,
      level: result.level,
      providerReference: kyb.reference,
      response: redact({ ...kyb, reasons: result.reasons }) as Record<string, unknown>,
      lastError: null,
      completedAt: new Date(),
    };
    // TypeORM's update() typing can't express jsonb Record columns; the value is a plain object.
    await manager.update(
      RiskAssessment,
      { id: input.assessmentId },
      completion as QueryDeepPartialEntity<RiskAssessment>,
    );
    await manager.update(
      MerchantApplication,
      { id: application.id },
      {
        riskStatus: RiskStatus.COMPLETED,
        status: nextStatus(application.status, ApplicationEvent.RISK_COMPLETED),
      },
    );
    await this.audit.record(manager, {
      action: AuditAction.RISK_REVIEW_COMPLETED,
      entityType: 'merchant_application',
      entityId: application.id,
      actor: null,
      correlationId: input.correlationId,
      metadata: {
        submissionVersion: application.submissionVersion,
        score: result.score,
        level: result.level,
      },
    });
  }
}
