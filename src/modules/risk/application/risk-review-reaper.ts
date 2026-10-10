import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import type { Queue } from 'bullmq';
import { DataSource, IsNull, LessThan } from 'typeorm';
import type { Env } from '../../../core/config/env';
import { OutboxEvent } from '../../../core/outbox/outbox-event.entity';
import { OutboxService } from '../../../core/outbox/outbox.service';
import { ApplicationStatus, RiskStatus } from '../../applications/domain/application.enums';
import { MerchantApplication } from '../../applications/infrastructure/persistence/merchant-application.entity';
import { RiskEvent } from '../domain/risk-events';
import { RiskAssessmentStatus } from '../domain/risk.enums';
import { RiskAssessment } from '../infrastructure/persistence/risk-assessment.entity';
import {
  RISK_REVIEW_QUEUE,
  type RiskReviewJobData,
  riskJobId,
} from '../infrastructure/queue/risk-queue';
import { MarkRiskReviewFailedUseCase } from './mark-risk-review-failed.use-case';

const STUCK_AFTER_MS = 15 * 60_000;

/**
 * Safety net for the rare gaps the happy path cannot close on its own: a job lost from Redis,
 * or a final failure whose "failed" handler crashed. Both are reconciled idempotently.
 */
@Injectable()
export class RiskReviewReaper {
  private readonly logger = new Logger(RiskReviewReaper.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly outbox: OutboxService,
    private readonly markFailed: MarkRiskReviewFailedUseCase,
    @InjectQueue(RISK_REVIEW_QUEUE) private readonly queue: Queue<RiskReviewJobData>,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Cron('*/5 * * * *', { name: 'risk-review-reaper' })
  async tick(): Promise<void> {
    try {
      const result = await this.reap();
      if (result.requeued || result.failed)
        this.logger.warn(result, 'Reconciled stuck risk reviews');
    } catch (error) {
      this.logger.error(error);
    }
  }

  async reap(olderThanMs = STUCK_AFTER_MS): Promise<{ requeued: number; failed: number }> {
    const stuck = await this.dataSource.getRepository(MerchantApplication).find({
      where: {
        status: ApplicationStatus.SUBMITTED,
        riskStatus: RiskStatus.PENDING,
        submittedAt: LessThan(new Date(Date.now() - olderThanMs)),
      },
      take: 100,
    });

    let requeued = 0;
    let failed = 0;
    for (const application of stuck) {
      const data = {
        applicationId: application.id,
        submissionVersion: application.submissionVersion,
        correlationId: null,
      };
      const job = await this.queue.getJob(riskJobId(application.id, application.submissionVersion));
      if (!job) {
        const waiting = await this.dataSource
          .getRepository(OutboxEvent)
          .existsBy({ aggregateId: application.id, processedAt: IsNull() });
        if (waiting) continue;
        await this.outbox.enqueue(this.dataSource.manager, {
          aggregateType: 'merchant_application',
          aggregateId: application.id,
          eventType: RiskEvent.REVIEW_REQUESTED,
          payload: {
            applicationId: application.id,
            submissionVersion: application.submissionVersion,
          },
        });
        requeued++;
      } else if ((await job.isFailed()) && job.attemptsMade >= (job.opts.attempts ?? 1)) {
        await this.markFailed.execute(data, job.failedReason ?? 'Retries exhausted');
        failed++;
      }
    }

    // Callback mode: the provider accepted the request but never reported back.
    const timeoutMs = this.config.get('KYB_CALLBACK_TIMEOUT_MS', { infer: true });
    const overdue = await this.dataSource.getRepository(RiskAssessment).find({
      where: {
        status: RiskAssessmentStatus.AWAITING_CALLBACK,
        updatedAt: LessThan(new Date(Date.now() - timeoutMs)),
      },
      take: 100,
    });
    for (const assessment of overdue) {
      await this.markFailed.execute(
        {
          applicationId: assessment.applicationId,
          submissionVersion: assessment.submissionVersion,
          correlationId: null,
        },
        'KYB callback not received before timeout',
      );
      failed++;
    }
    return { requeued, failed };
  }
}
