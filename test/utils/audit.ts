import type { INestApplication } from '@nestjs/common';
import { OutboxRelay } from '../../src/core/outbox/outbox-relay';
import {
  AUDIT_READER,
  type AuditQuery,
  type AuditReader,
  type AuditRecord,
} from '../../src/modules/audit/domain/audit-record';

/** Reads audit entries through the port; in Mongo mode, first projects pending outbox events. */
export async function findAuditEntries(
  app: INestApplication,
  query: Partial<AuditQuery>,
): Promise<AuditRecord[]> {
  if (process.env.AUDIT_STORE === 'mongo') await app.get(OutboxRelay).relayBatch(500);
  const page = await app.get<AuditReader>(AUDIT_READER).find({ page: 1, pageSize: 100, ...query });
  return page.items;
}
