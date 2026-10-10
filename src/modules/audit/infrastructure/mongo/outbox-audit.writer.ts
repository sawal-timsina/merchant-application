import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { OutboxService } from '../../../../core/outbox/outbox.service';
import type { AuditWriter, NewAuditRecord } from '../../domain/audit-record';

export const AUDIT_RECORDED = 'AuditRecorded';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_AGGREGATE = '00000000-0000-0000-0000-000000000000';

/**
 * Mongo cannot join the Postgres transaction, so the entry rides the outbox: it commits iff the
 * action does, and the worker projects it into Mongo afterwards.
 */
@Injectable()
export class OutboxAuditWriter implements AuditWriter {
  constructor(private readonly outbox: OutboxService) {}

  async write(manager: EntityManager, record: NewAuditRecord): Promise<void> {
    await this.outbox.enqueue(manager, {
      aggregateType: 'audit',
      aggregateId: record.entityId && UUID.test(record.entityId) ? record.entityId : NO_AGGREGATE,
      eventType: AUDIT_RECORDED,
      payload: { ...record, createdAt: new Date().toISOString() },
    });
  }
}
