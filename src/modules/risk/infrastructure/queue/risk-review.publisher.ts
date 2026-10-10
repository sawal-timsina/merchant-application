import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { OutboxEvent } from '../../../../core/outbox/outbox-event.entity';
import { OutboxPublisherRegistry } from '../../../../core/outbox/outbox-publisher.registry';
import { RiskEvent, type RiskReviewRequestedPayload } from '../../domain/risk-events';
import { RISK_REVIEW_QUEUE, type RiskReviewJobData, riskJobId } from './risk-queue';

@Injectable()
export class RiskReviewPublisher implements OnModuleInit {
  constructor(
    private readonly registry: OutboxPublisherRegistry,
    @InjectQueue(RISK_REVIEW_QUEUE) private readonly queue: Queue<RiskReviewJobData>,
  ) {}

  onModuleInit(): void {
    this.registry.register(RiskEvent.REVIEW_REQUESTED, (event) => this.enqueue(event));
    this.registry.register(RiskEvent.REVIEW_RETRY_REQUESTED, (event) => this.retry(event));
  }

  private async enqueue(event: OutboxEvent): Promise<void> {
    const { applicationId, submissionVersion } =
      event.payload as unknown as RiskReviewRequestedPayload;
    await this.queue.add(
      'review',
      { applicationId, submissionVersion, correlationId: event.correlationId },
      { jobId: riskJobId(applicationId, submissionVersion) },
    );
  }

  /** A failed job keeps its id, so add() would be ignored: retry it in place, or add if it is gone. */
  private async retry(event: OutboxEvent): Promise<void> {
    const { applicationId, submissionVersion } =
      event.payload as unknown as RiskReviewRequestedPayload;
    const job = await this.queue.getJob(riskJobId(applicationId, submissionVersion));
    if (job && (await job.isFailed())) {
      return job.retry('failed', { resetAttemptsMade: true, resetAttemptsStarted: true });
    }
    if (!job) return this.enqueue(event);
  }
}
