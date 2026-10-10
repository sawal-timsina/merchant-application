import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { RequestContext } from '../../../../core/request-context/request-context';
import { MarkRiskReviewFailedUseCase } from '../../application/mark-risk-review-failed.use-case';
import {
  type ProcessRiskReviewResult,
  ProcessRiskReviewUseCase,
} from '../../application/process-risk-review.use-case';
import { RISK_REVIEW_DLQ, RISK_REVIEW_QUEUE, type RiskReviewJobData } from './risk-queue';

/** Thin adapter: all business logic and idempotency live in the use cases. */
@Processor(RISK_REVIEW_QUEUE, { concurrency: 5 })
export class RiskReviewProcessor extends WorkerHost {
  private readonly logger = new Logger(RiskReviewProcessor.name);

  constructor(
    private readonly processRiskReview: ProcessRiskReviewUseCase,
    private readonly markFailed: MarkRiskReviewFailedUseCase,
    @InjectQueue(RISK_REVIEW_DLQ) private readonly deadLetters: Queue,
  ) {
    super();
  }

  process(job: Job<RiskReviewJobData>): Promise<ProcessRiskReviewResult> {
    const requestId = job.data.correlationId ?? job.id ?? 'risk-review';
    return RequestContext.run({ requestId, ip: null, actor: null }, () =>
      this.processRiskReview.execute(job.data),
    );
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<RiskReviewJobData> | undefined, error: Error): Promise<void> {
    if (!job || job.attemptsMade < (job.opts.attempts ?? 1)) return; // BullMQ will retry
    try {
      await this.markFailed.execute(job.data, error.message);
      await this.deadLetters.add(
        'dead-letter',
        { ...job.data, error: error.message, failedAt: new Date().toISOString() },
        { jobId: job.id, removeOnComplete: false },
      );
    } catch (handlerError) {
      // The reaper reconciles this case.
      this.logger.error(handlerError);
    }
  }
}
