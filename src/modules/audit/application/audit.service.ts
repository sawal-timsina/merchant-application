import { Inject, Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { redact } from '../../../core/redaction/redact';
import { RequestContext } from '../../../core/request-context/request-context';
import type { AuditAction } from '../domain/audit-action';
import { AUDIT_WRITER, type AuditWriter } from '../domain/audit-record';

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
 * Takes the caller's EntityManager so the audit entry commits or rolls back together with the
 * action it describes. Where the entry is stored is the writer adapter's concern.
 */
@Injectable()
export class AuditService {
  constructor(@Inject(AUDIT_WRITER) private readonly writer: AuditWriter) {}

  async record(manager: EntityManager, entry: AuditEntry): Promise<void> {
    const context = RequestContext.get();
    const actor = entry.actor === undefined ? (context?.actor ?? null) : entry.actor;
    await this.writer.write(manager, {
      actorId: actor?.id ?? null,
      actorRole: actor?.role ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      metadata: redact(entry.metadata ?? {}) as Record<string, unknown>,
      requestId: entry.correlationId ?? context?.requestId ?? null,
      ip: context?.ip ?? null,
    });
  }
}
