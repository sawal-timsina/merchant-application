import { Injectable, type OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import type { OutboxEvent } from '../../../../core/outbox/outbox-event.entity';
import { OutboxPublisherRegistry } from '../../../../core/outbox/outbox-publisher.registry';
import type { NewAuditRecord } from '../../domain/audit-record';
import { AuditLogDocument } from './audit-log.schema';
import { AUDIT_RECORDED } from './outbox-audit.writer';

const DUPLICATE_KEY = 11000;

/**
 * Projects AuditRecorded outbox events into Mongo. `_id` = outbox event id, so a re-relayed
 * event hits the unique _id index and is treated as already projected.
 */
@Injectable()
export class MongoAuditProjector implements OnModuleInit {
  constructor(
    private readonly registry: OutboxPublisherRegistry,
    @InjectModel(AuditLogDocument.name) private readonly logs: Model<AuditLogDocument>,
  ) {}

  onModuleInit(): void {
    this.registry.register(AUDIT_RECORDED, (event) => this.project(event));
  }

  private async project(event: OutboxEvent): Promise<void> {
    const payload = event.payload as unknown as NewAuditRecord & { createdAt: string };
    try {
      await this.logs.create({ ...payload, _id: event.id, createdAt: new Date(payload.createdAt) });
    } catch (error) {
      if ((error as { code?: number }).code !== DUPLICATE_KEY) throw error;
    }
  }
}
