import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import type { Page } from '../../../../core/http/pagination';
import type {
  AuditQuery,
  AuditReader,
  AuditRecord,
  DecisionStatsRow,
} from '../../domain/audit-record';
import { AuditLogDocument } from './audit-log.schema';

/** Counts decisions of one kind inside a $group stage. */
const countIf = (decision: string) => ({
  $sum: { $cond: [{ $eq: ['$metadata.decision', decision] }, 1, 0] },
});

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

  /** Served by the { action: 1, createdAt: -1 } index created in infra/mongo/init. */
  decisionStats(range: { from: Date; to: Date }): Promise<DecisionStatsRow[]> {
    return this.logs
      .aggregate<DecisionStatsRow>([
        {
          $match: {
            action: 'APPLICATION_DECISION_RECORDED',
            createdAt: { $gte: range.from, $lt: range.to },
          },
        },
        {
          $group: {
            _id: {
              day: { $dateToString: { date: '$createdAt', format: '%Y-%m-%d', timezone: 'UTC' } },
              reviewerId: '$actorId',
            },
            approved: countIf('APPROVE'),
            rejected: countIf('REJECT'),
            infoRequested: countIf('REQUEST_INFO'),
            total: { $sum: 1 },
          },
        },
        {
          $project: {
            _id: 0,
            day: '$_id.day',
            reviewerId: '$_id.reviewerId',
            approved: 1,
            rejected: 1,
            infoRequested: 1,
            total: 1,
          },
        },
        { $sort: { day: 1, reviewerId: 1 } },
      ])
      .exec();
  }
}
