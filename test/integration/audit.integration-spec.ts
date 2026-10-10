import type { INestApplication } from '@nestjs/common';
import { UserRole } from '../../src/modules/identity/domain/user-role';
import { createApplication } from '../utils/applications';
import { findAuditEntries } from '../utils/audit';
import { bearer, loginAs } from '../utils/auth';
import { createUser } from '../utils/factories';
import { createTestApp, http } from '../utils/test-app';

// Runs in both the `integration` (Postgres) and `integration-mongo` projects.
describe(`Audit trail (${process.env.AUDIT_STORE ?? 'postgres'} store)`, () => {
  let app: INestApplication;
  let sales: string;
  let admin: string;
  beforeAll(async () => {
    app = await createTestApp({ worker: true });
    sales = await loginAs(app, await createUser(app, { role: UserRole.SALES }));
    admin = await loginAs(app, await createUser(app, { role: UserRole.ADMIN }));
  });
  afterAll(async () => app.close());

  it('records actions with actor and request id, masked and without secrets', async () => {
    const created = await createApplication(app, sales);
    const submitted = await http(app)
      .post(`/applications/${created.id}/submit`)
      .set(...bearer(sales))
      .expect(200);
    const entries = await findAuditEntries(app, {
      entityType: 'merchant_application',
      entityId: created.id,
    });
    expect(entries.map((e) => e.action)).toEqual(['APPLICATION_SUBMITTED', 'APPLICATION_CREATED']);
    expect(entries[0]).toMatchObject({
      actorRole: 'SALES',
      requestId: submitted.headers['x-request-id'],
    });
    expect(entries[1]!.metadata.ownerEmail).toBe('j***@example.com');
    expect(JSON.stringify(entries)).not.toContain('TEST-000123456');
  });

  it('exposes history to ADMIN only, newest first, filterable and paginated', async () => {
    const created = await createApplication(app, sales);
    await findAuditEntries(app, { entityId: created.id }); // projects pending events in Mongo mode
    const res = await http(app)
      .get(`/audit?entityType=merchant_application&entityId=${created.id}&pageSize=1`)
      .set(...bearer(admin))
      .expect(200);
    expect(res.body).toMatchObject({ page: 1, pageSize: 1, total: 1 });
    expect(res.body.items[0].action).toBe('APPLICATION_CREATED');
    await http(app)
      .get('/audit')
      .set(...bearer(sales))
      .expect(403);
  });

  it('keeps the entry atomic with the action: a rejected update leaves no entry', async () => {
    const created = await createApplication(app, sales);
    await http(app)
      .patch(`/applications/${created.id}`)
      .set(...bearer(sales))
      .send({ businessName: 'X', version: 99 })
      .expect(409);
    const entries = await findAuditEntries(app, {
      entityId: created.id,
      action: 'APPLICATION_UPDATED',
    });
    expect(entries).toHaveLength(0);
  });
});
