import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { OutboxEvent } from './outbox-event.entity';
import { OutboxPublisherRegistry } from './outbox-publisher.registry';

const MAX_BACKOFF_MS = 5 * 60_000;
export const relayBackoffMs = (attempts: number) =>
  Math.min(1000 * 2 ** (attempts - 1), MAX_BACKOFF_MS);

/**
 * Worker-only. Publishes due outbox events. SKIP LOCKED lets several worker replicas share
 * the table without double-publishing; a crash after publish but before marking processed only
 * causes a re-publish, which handlers make idempotent (deterministic job ids).
 */
@Injectable()
export class OutboxRelay {
  private readonly logger = new Logger(OutboxRelay.name);
  private running = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly registry: OutboxPublisherRegistry,
  ) {}

  @Interval('outbox-relay', 1000)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.relayBatch();
    } catch (error) {
      this.logger.error(error);
    } finally {
      this.running = false;
    }
  }

  async relayBatch(limit = 50): Promise<number> {
    return this.dataSource.transaction(async (manager) => {
      const events = await manager
        .createQueryBuilder(OutboxEvent, 'e')
        .where('e.processedAt IS NULL AND e.availableAt <= now()')
        .orderBy('e.availableAt', 'ASC')
        .limit(limit)
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .getMany();

      for (const event of events) {
        const handler = this.registry.get(event.eventType);
        try {
          if (!handler) throw new Error(`No outbox handler for ${event.eventType}`);
          await handler(event);
          await manager.update(
            OutboxEvent,
            { id: event.id },
            { processedAt: new Date(), lastError: null },
          );
        } catch (error) {
          const attempts = event.attempts + 1;
          await manager.update(
            OutboxEvent,
            { id: event.id },
            {
              attempts,
              lastError: (error as Error).message.slice(0, 2000),
              availableAt: new Date(Date.now() + relayBackoffMs(attempts)),
            },
          );
        }
      }
      return events.length;
    });
  }
}
