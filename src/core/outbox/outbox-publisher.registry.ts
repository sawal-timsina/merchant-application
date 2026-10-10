import { Injectable } from '@nestjs/common';
import type { OutboxEvent } from './outbox-event.entity';

export type OutboxHandler = (event: OutboxEvent) => Promise<void>;

@Injectable()
export class OutboxPublisherRegistry {
  private readonly handlers = new Map<string, OutboxHandler>();

  register(eventType: string, handler: OutboxHandler): void {
    if (this.handlers.has(eventType)) throw new Error(`Duplicate outbox handler for ${eventType}`);
    this.handlers.set(eventType, handler);
  }

  get(eventType: string): OutboxHandler | undefined {
    return this.handlers.get(eventType);
  }
}
