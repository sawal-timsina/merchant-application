import type { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { DataSource } from 'typeorm';
import { OutboxRelay } from '../../src/core/outbox/outbox-relay';
import { UserRole } from '../../src/modules/identity/domain/user-role';
import { createApplication } from '../utils/applications';
import { loginAs } from '../utils/auth';
import { createUser } from '../utils/factories';
import { createTestApp } from '../utils/test-app';

// integration-mongo project only (excluded from the Postgres project).
describe('Mongo audit store', () => {
  let app: INestApplication;
  let sales: string;
  beforeAll(async () => {
    app = await createTestApp({ worker: true });
    sales = await loginAs(app, await createUser(app, { role: UserRole.SALES }));
  });
  afterAll(async () => app.close());

  const collection = () => app.get<Connection>(getConnectionToken()).collection('audit_logs');

  it('projects each outbox event exactly once, even when relayed again after a crash', async () => {
    const created = await createApplication(app, sales);
    await app.get(OutboxRelay).relayBatch(500);
    await app
      .get(DataSource)
      .query(
        `UPDATE outbox_events SET processed_at = NULL WHERE event_type = 'AuditRecorded' AND payload->>'entityId' = $1`,
        [created.id],
      );
    await app.get(OutboxRelay).relayBatch(500);
    expect(
      await collection().countDocuments({ entityId: created.id, action: 'APPLICATION_CREATED' }),
    ).toBe(1);
  });

  it('denies updates and deletes to the application user', async () => {
    const created = await createApplication(app, sales);
    await app.get(OutboxRelay).relayBatch(500);
    await expect(
      collection().updateOne({ entityId: created.id }, { $set: { action: 'TAMPERED' } }),
    ).rejects.toThrow(/not authorized/i);
    await expect(collection().deleteOne({ entityId: created.id })).rejects.toThrow(
      /not authorized/i,
    );
  });
});
