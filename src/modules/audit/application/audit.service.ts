import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { redact } from '../../../core/redaction/redact';
import { RequestContext } from '../../../core/request-context/request-context';
import type { UserRole } from '../../identity/domain/user-role';
import type { AuditAction } from '../domain/audit-action';
import { AuditLog } from '../infrastructure/persistence/audit-log.entity';

export interface AuditEntry {
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  /** Defaults to the request's authenticated actor; pass null for system actions. */
  actor?: { id: string; role: string } | null;
  correlationId?: string | null;
}

/**
 * Takes the caller's EntityManager so the audit row commits or rolls back together with the
 * action it describes.
 */
@Injectable()
export class AuditService {
  async record(manager: EntityManager, entry: AuditEntry): Promise<void> {
    const context = RequestContext.get();
    const actor = entry.actor === undefined ? (context?.actor ?? null) : entry.actor;
    const log = manager.create(AuditLog, {
      actorId: actor?.id ?? null,
      actorRole: (actor?.role as UserRole | undefined) ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      metadata: redact(entry.metadata ?? {}) as Record<string, unknown>,
      requestId: entry.correlationId ?? context?.requestId ?? null,
      ip: context?.ip ?? null,
    });
    await manager.save(log);
  }
}
