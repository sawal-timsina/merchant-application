import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import type { Page } from '../../../../core/http/pagination';
import type { AuditQuery, AuditReader, AuditRecord } from '../../domain/audit-record';
import { AuditLogDocument } from './audit-log.schema';

@Injectable()
export class MongoAuditReader implements AuditReader {
  constructor(@InjectModel(AuditLogDocument.name) private readonly logs: Model<AuditLogDocument>) {}

  async find(query: AuditQuery): Promise<Page<AuditRecord>> {
    const filter = {
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.action ? { action: query.action } : {}),
    };
    const [docs, total] = await Promise.all([
      this.logs
        .find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((query.page - 1) * query.pageSize)
        .limit(query.pageSize)
        .lean<AuditLogDocument[]>(),
      this.logs.countDocuments(filter),
    ]);
    const items = docs.map((doc): AuditRecord => ({
      id: doc._id,
      actorId: doc.actorId,
      actorRole: doc.actorRole,
      action: doc.action,
      entityType: doc.entityType,
      entityId: doc.entityId,
      metadata: doc.metadata,
      requestId: doc.requestId,
      ip: doc.ip,
      createdAt: doc.createdAt,
    }));
    return { items, total, page: query.page, pageSize: query.pageSize };
  }
}
