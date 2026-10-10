import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../core/config/env';
import { MarkRiskReviewFailedUseCase } from './application/mark-risk-review-failed.use-case';
import { ProcessRiskReviewUseCase } from './application/process-risk-review.use-case';
import { RiskReviewReaper } from './application/risk-review-reaper';
import { CALLBACK_KYB_PROVIDER, KYB_MODE, KYB_PROVIDER } from './domain/kyb-provider';
import { FakeKybProvider } from './infrastructure/providers/fake-kyb.provider';
import { RiskReviewProcessor } from './infrastructure/queue/risk-review.processor';
import { RiskReviewPublisher } from './infrastructure/queue/risk-review.publisher';
import { RiskModule } from './risk.module';

/** Worker-side risk processing: queue publisher, processor, use cases and the reaper. */
@Module({
  imports: [RiskModule],
  providers: [
    RiskReviewPublisher,
    ProcessRiskReviewUseCase,
    MarkRiskReviewFailedUseCase,
    RiskReviewProcessor,
    RiskReviewReaper,
    {
      provide: FakeKybProvider,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new FakeKybProvider({
          latencyMs: config.get('KYB_LATENCY_MS', { infer: true }),
          failureRate: config.get('KYB_FAILURE_RATE', { infer: true }),
          callback: {
            url: config.get('KYB_WEBHOOK_URL', { infer: true }),
            secret: config.get('KYB_WEBHOOK_SECRETS', { infer: true })[0]!,
          },
        }),
    },
    // The simulated provider serves both modes; a real integration would bind real clients here.
    { provide: KYB_PROVIDER, useExisting: FakeKybProvider },
    { provide: CALLBACK_KYB_PROVIDER, useExisting: FakeKybProvider },
    {
      provide: KYB_MODE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => config.get('KYB_MODE', { infer: true }),
    },
  ],
  exports: [ProcessRiskReviewUseCase],
})
export class RiskWorkerModule {}
