import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import type { Page } from '../../../../core/http/pagination';
import type {
  AuditQuery,
  AuditReader,
  AuditRecord,
  DecisionStatsRow,
} from '../../domain/audit-record';
import { AuditLog } from '../persistence/audit-log.entity';

@Injectable()
export class PostgresAuditReader implements AuditReader {
  constructor(@InjectRepository(AuditLog) private readonly logs: Repository<AuditLog>) {}

  async find(query: AuditQuery): Promise<Page<AuditRecord>> {
    const [items, total] = await this.logs.findAndCount({
      where: {
        ...(query.entityType ? { entityType: query.entityType } : {}),
        ...(query.entityId ? { entityId: query.entityId } : {}),
        ...(query.action ? { action: query.action } : {}),
      },
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  decisionStats(range: { from: Date; to: Date }): Promise<DecisionStatsRow[]> {
    return this.logs.query(
      `SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
              actor_id AS "reviewerId",
              count(*) FILTER (WHERE metadata->>'decision' = 'APPROVE')::int      AS approved,
              count(*) FILTER (WHERE metadata->>'decision' = 'REJECT')::int       AS rejected,
              count(*) FILTER (WHERE metadata->>'decision' = 'REQUEST_INFO')::int AS "infoRequested",
              count(*)::int AS total
         FROM audit_logs
        WHERE action = 'APPLICATION_DECISION_RECORDED' AND created_at >= $1 AND created_at < $2
        GROUP BY 1, 2
        ORDER BY 1, 2`,
      [range.from, range.to],
    );
  }
}
