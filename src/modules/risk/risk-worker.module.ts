import { Module } from '@nestjs/common';
import { OutboxPublisherRegistry } from '../../core/outbox/outbox-publisher.registry';
import { OutboxRelay } from '../../core/outbox/outbox-relay';
import { RiskReviewPublisher } from './infrastructure/queue/risk-review.publisher';
import { RiskModule } from './risk.module';

/** Worker-side risk processing: outbox relay, queue publisher and (later) the processor. */
@Module({
  imports: [RiskModule],
  providers: [OutboxPublisherRegistry, OutboxRelay, RiskReviewPublisher],
  exports: [OutboxRelay, OutboxPublisherRegistry],
})
export class RiskWorkerModule {}
