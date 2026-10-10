import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../core/config/env';
import { OutboxPublisherRegistry } from '../../core/outbox/outbox-publisher.registry';
import { OutboxRelay } from '../../core/outbox/outbox-relay';
import { AuditModule } from '../audit/audit.module';
import { MarkRiskReviewFailedUseCase } from './application/mark-risk-review-failed.use-case';
import { ProcessRiskReviewUseCase } from './application/process-risk-review.use-case';
import { KYB_PROVIDER } from './domain/kyb-provider';
import { FakeKybProvider } from './infrastructure/providers/fake-kyb.provider';
import { RiskReviewProcessor } from './infrastructure/queue/risk-review.processor';
import { RiskReviewPublisher } from './infrastructure/queue/risk-review.publisher';
import { RiskModule } from './risk.module';

/** Worker-side risk processing: outbox relay, queue publisher, processor and use cases. */
@Module({
  imports: [RiskModule, AuditModule],
  providers: [
    OutboxPublisherRegistry,
    OutboxRelay,
    RiskReviewPublisher,
    ProcessRiskReviewUseCase,
    MarkRiskReviewFailedUseCase,
    RiskReviewProcessor,
    {
      provide: KYB_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new FakeKybProvider({
          latencyMs: config.get('KYB_LATENCY_MS', { infer: true }),
          failureRate: config.get('KYB_FAILURE_RATE', { infer: true }),
        }),
    },
  ],
  exports: [OutboxRelay, OutboxPublisherRegistry, ProcessRiskReviewUseCase],
})
export class RiskWorkerModule {}
