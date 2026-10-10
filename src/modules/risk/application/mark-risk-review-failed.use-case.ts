import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { RiskStatus } from '../../applications/domain/application.enums';
import { MerchantApplication } from '../../applications/infrastructure/persistence/merchant-application.entity';
import { AuditService } from '../../audit/application/audit.service';
import { AuditAction } from '../../audit/domain/audit-action';
import { RiskAssessmentStatus } from '../domain/risk.enums';
import { RiskAssessment } from '../infrastructure/persistence/risk-assessment.entity';
import type { RiskReviewJobData } from '../infrastructure/queue/risk-queue';

/** Called once retries are exhausted. Idempotent: no-op if already failed, completed or stale. */
@Injectable()
export class MarkRiskReviewFailedUseCase {
  constructor(
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  async execute(data: RiskReviewJobData, error: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const application = await manager.findOne(MerchantApplication, {
        where: { id: data.applicationId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!application || application.submissionVersion !== data.submissionVersion) return;
      if (application.riskStatus !== RiskStatus.PENDING) return;

      await manager.update(
        RiskAssessment,
        { applicationId: data.applicationId, submissionVersion: data.submissionVersion },
        { status: RiskAssessmentStatus.FAILED, lastError: error.slice(0, 2000) },
      );
      await manager.update(
        MerchantApplication,
        { id: application.id },
        { riskStatus: RiskStatus.FAILED },
      );
      await this.audit.record(manager, {
        action: AuditAction.RISK_REVIEW_FAILED,
        entityType: 'merchant_application',
        entityId: application.id,
        actor: null,
        correlationId: data.correlationId,
        metadata: { submissionVersion: data.submissionVersion, error: error.slice(0, 500) },
      });
    });
  }
}
