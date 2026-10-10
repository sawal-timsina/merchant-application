import { Inject, Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { ApplicationStatus } from '../../applications/domain/application.enums';
import { MerchantApplication } from '../../applications/infrastructure/persistence/merchant-application.entity';
import {
  CALLBACK_KYB_PROVIDER,
  type CallbackKybProvider,
  KYB_MODE,
  KYB_PROVIDER,
  type KybMode,
  type KybProvider,
} from '../domain/kyb-provider';
import { RiskAssessmentStatus } from '../domain/risk.enums';
import type { KybResult } from '../domain/risk-scoring';
import { RiskAssessment } from '../infrastructure/persistence/risk-assessment.entity';
import type { RiskReviewJobData } from '../infrastructure/queue/risk-queue';
import { RiskAssessmentCompleter } from './risk-assessment-completer';

export type ProcessRiskReviewResult =
  'completed' | 'already-completed' | 'stale' | 'awaiting-callback';

/**
 * Idempotent by construction:
 *  1. lock the application; skip if the job belongs to an older submission
 *  2. get-or-create the assessment for (application, submission), unique in the DB; skip if done
 *  3. call the provider OUTSIDE any transaction (no locks held during network I/O)
 *  4. re-lock and re-check, then write the result and the status transition atomically
 * A retry, a duplicate delivery or a concurrent worker therefore cannot apply a result twice.
 * In callback mode step 4 only records the provider reference; the webhook completes it.
 */
@Injectable()
export class ProcessRiskReviewUseCase {
  constructor(
    private readonly dataSource: DataSource,
    private readonly completer: RiskAssessmentCompleter,
    @Inject(KYB_PROVIDER) private readonly kyb: KybProvider,
    @Inject(CALLBACK_KYB_PROVIDER) private readonly callbackKyb: CallbackKybProvider,
    @Inject(KYB_MODE) private readonly mode: KybMode,
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
      if (assessment.status === RiskAssessmentStatus.AWAITING_CALLBACK) {
        return 'awaiting-callback' as const;
      }
      if (application.status !== ApplicationStatus.SUBMITTED) return 'stale' as const;
      await manager.increment(RiskAssessment, { id: assessment.id }, 'attempts', 1);
      return { application, assessmentId: assessment.id };
    });
    if (typeof prepared === 'string') return prepared;
    if (this.mode === 'callback') return this.requestCallback(data, prepared);

    let kyb: KybResult;
    try {
      kyb = await this.kyb.verify({
        applicationId: data.applicationId,
        legalBusinessName: prepared.application.legalBusinessName,
      });
    } catch (error) {
      await this.recordError(prepared.assessmentId, error);
      throw error; // BullMQ retries with backoff
    }

    return this.dataSource.transaction(async (manager) => {
      const application = await this.lockCurrent(manager, data);
      if (!application) return 'stale';
      const assessment = await manager.findOneByOrFail(RiskAssessment, {
        id: prepared.assessmentId,
      });
      if (assessment.status === RiskAssessmentStatus.COMPLETED) return 'already-completed';
      if (application.status !== ApplicationStatus.SUBMITTED) return 'stale';
      await this.completer.complete(manager, {
        application,
        assessmentId: assessment.id,
        kyb,
        correlationId: data.correlationId,
      });
      return 'completed';
    });
  }

  private async requestCallback(
    data: RiskReviewJobData,
    prepared: { application: MerchantApplication; assessmentId: string },
  ): Promise<ProcessRiskReviewResult> {
    let reference: string;
    try {
      ({ reference } = await this.callbackKyb.requestVerification({
        applicationId: data.applicationId,
        legalBusinessName: prepared.application.legalBusinessName,
      }));
    } catch (error) {
      await this.recordError(prepared.assessmentId, error);
      throw error;
    }
    return this.dataSource.transaction(async (manager) => {
      const application = await this.lockCurrent(manager, data);
      if (!application) return 'stale';
      await manager.update(
        RiskAssessment,
        { id: prepared.assessmentId },
        {
          status: RiskAssessmentStatus.AWAITING_CALLBACK,
          providerReference: reference,
          lastError: null,
        },
      );
      return 'awaiting-callback';
    });
  }

  private async recordError(assessmentId: string, error: unknown): Promise<void> {
    await this.dataSource.getRepository(RiskAssessment).update(assessmentId, {
      lastError: (error as Error).message.slice(0, 2000),
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
