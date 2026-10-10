import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { RequestContext } from '../request-context/request-context';
import { OutboxEvent } from './outbox-event.entity';

export interface NewOutboxEvent {
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
}

@Injectable()
export class OutboxService {
  /** Must be called with the transaction's manager: the event commits iff the state change does. */
  enqueue(manager: EntityManager, event: NewOutboxEvent): Promise<OutboxEvent> {
    return manager.save(
      manager.create(OutboxEvent, {
        ...event,
        correlationId: RequestContext.get()?.requestId ?? null,
      }),
    );
  }
}
