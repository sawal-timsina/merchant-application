import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { UserRole } from '../../../identity/domain/user-role';
import type { AuditWriter, NewAuditRecord } from '../../domain/audit-record';
import { AuditLog } from '../persistence/audit-log.entity';

@Injectable()
export class PostgresAuditWriter implements AuditWriter {
  async write(manager: EntityManager, record: NewAuditRecord): Promise<void> {
    await manager.save(
      manager.create(AuditLog, { ...record, actorRole: record.actorRole as UserRole | null }),
    );
  }
}
