import { Module } from '@nestjs/common';
import { OutboxRelay } from './outbox-relay';

/** Worker-only: relays committed outbox events to their publishers. */
@Module({
  providers: [OutboxRelay],
  exports: [OutboxRelay],
})
export class OutboxWorkerModule {}
