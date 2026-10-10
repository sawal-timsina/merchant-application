import { Inject, Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { redact } from '../../../core/redaction/redact';
import { ApplicationStatus, RiskStatus } from '../../applications/domain/application.enums';
import { ApplicationEvent, nextStatus } from '../../applications/domain/application-state-machine';
import { MerchantApplication } from '../../applications/infrastructure/persistence/merchant-application.entity';
import { AuditService } from '../../audit/application/audit.service';
import { AuditAction } from '../../audit/domain/audit-action';
import { KYB_PROVIDER, type KybProvider } from '../domain/kyb-provider';
import { RiskAssessmentStatus } from '../domain/risk.enums';
import { type KybResult, scoreApplication } from '../domain/risk-scoring';
import { RiskAssessment } from '../infrastructure/persistence/risk-assessment.entity';
import type { RiskReviewJobData } from '../infrastructure/queue/risk-queue';

export type ProcessRiskReviewResult = 'completed' | 'already-completed' | 'stale';

/**
 * Idempotent by construction:
 *  1. lock the application; skip if the job belongs to an older submission
 *  2. get-or-create the assessment for (application, submission), unique in the DB; skip if done
 *  3. call the provider OUTSIDE any transaction (no locks held during network I/O)
 *  4. re-lock and re-check, then write the result and the status transition atomically
 * A retry, a duplicate delivery or a concurrent worker therefore cannot apply a result twice.
 */
@Injectable()
export class ProcessRiskReviewUseCase {
  constructor(
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    @Inject(KYB_PROVIDER) private readonly kyb: KybProvider,
  ) {}

  async execute(data: RiskReviewJobData): Promise<ProcessRiskReviewResult> {
    const prepared = await this.dataSource.transaction(async (manager) => {
      const application = await this.lockCurrent(manager, data);
      if (!application) return 'stale' as const;
      await manager
        .createQueryBuilder()
        .insert()
        .into(RiskAssessment)
        .values({ applicationId: data.applicationId, submissionVersion: data.submissionVersion })
        .orIgnore()
        .execute();
      const assessment = await manager.findOneByOrFail(RiskAssessment, {
        applicationId: data.applicationId,
        submissionVersion: data.submissionVersion,
      });
      // Order matters: a completed result is reported as such even though status has moved on.
      if (assessment.status === RiskAssessmentStatus.COMPLETED) return 'already-completed' as const;
      if (application.status !== ApplicationStatus.SUBMITTED) return 'stale' as const;
      await manager.increment(RiskAssessment, { id: assessment.id }, 'attempts', 1);
      return { application, assessmentId: assessment.id };
    });
    if (typeof prepared === 'string') return prepared;

    let kyb: KybResult;
    try {
      kyb = await this.kyb.verify({
        applicationId: data.applicationId,
        legalBusinessName: prepared.application.legalBusinessName,
      });
    } catch (error) {
      await this.dataSource.getRepository(RiskAssessment).update(prepared.assessmentId, {
        lastError: (error as Error).message.slice(0, 2000),
      });
      throw error; // BullMQ retries with backoff
    }
    const result = scoreApplication(prepared.application, kyb);

    return this.dataSource.transaction(async (manager) => {
      const application = await this.lockCurrent(manager, data);
      if (!application) return 'stale';
      const assessment = await manager.findOneByOrFail(RiskAssessment, {
        id: prepared.assessmentId,
      });
      if (assessment.status === RiskAssessmentStatus.COMPLETED) return 'already-completed';
      if (application.status !== ApplicationStatus.SUBMITTED) return 'stale';

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
        { id: assessment.id },
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
        correlationId: data.correlationId,
        metadata: {
          submissionVersion: data.submissionVersion,
          score: result.score,
          level: result.level,
        },
      });
      return 'completed';
    });
  }

  /** Locks the application; null if it no longer exists or the job belongs to an older submission. */
  private async lockCurrent(
    manager: EntityManager,
    data: RiskReviewJobData,
  ): Promise<MerchantApplication | null> {
    const application = await manager.findOne(MerchantApplication, {
      where: { id: data.applicationId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!application || application.submissionVersion !== data.submissionVersion) return null;
    return application;
  }
}
