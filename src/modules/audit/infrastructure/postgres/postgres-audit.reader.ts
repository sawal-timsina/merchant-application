import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import type { Page } from '../../../../core/http/pagination';
import type { AuditQuery, AuditReader, AuditRecord } from '../../domain/audit-record';
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
}
