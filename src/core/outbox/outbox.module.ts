import { Module } from '@nestjs/common';
import { OutboxPublisherRegistry } from './outbox-publisher.registry';
import { OutboxService } from './outbox.service';

/** Writing events and registering their publishers; available everywhere through CoreModule. */
@Module({
  providers: [OutboxService, OutboxPublisherRegistry],
  exports: [OutboxService, OutboxPublisherRegistry],
})
export class OutboxModule {}
