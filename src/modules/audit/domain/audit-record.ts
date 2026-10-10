import type { EntityManager } from 'typeorm';
import type { Page } from '../../../core/http/pagination';

export interface AuditRecord {
  id: string;
  actorId: string | null;
  actorRole: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown>;
  requestId: string | null;
  ip: string | null;
  createdAt: Date;
}

export type NewAuditRecord = Omit<AuditRecord, 'id' | 'createdAt'>;

export const AUDIT_WRITER = Symbol('AUDIT_WRITER');
/**
 * Writes inside the caller's transaction so the entry commits iff the action does. (The
 * transaction handle is part of the contract, hence the EntityManager type in this port.)
 */
export interface AuditWriter {
  write(manager: EntityManager, record: NewAuditRecord): Promise<void>;
}

export interface AuditQuery {
  entityType?: string;
  entityId?: string;
  action?: string;
  page: number;
  pageSize: number;
}

export const AUDIT_READER = Symbol('AUDIT_READER');
export interface AuditReader {
  find(query: AuditQuery): Promise<Page<AuditRecord>>;
}
