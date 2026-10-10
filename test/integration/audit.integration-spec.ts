import type { INestApplication } from '@nestjs/common';
import { UserRole } from '../../src/modules/identity/domain/user-role';
import { createApplication } from '../utils/applications';
import { bearer, loginAs } from '../utils/auth';
import { createUser } from '../utils/factories';
import { createTestApp, http } from '../utils/test-app';

describe('Audit trail API', () => {
  let app: INestApplication;
  let sales: string;
  let admin: string;
  beforeAll(async () => {
    app = await createTestApp();
    sales = await loginAs(app, await createUser(app, { role: UserRole.SALES }));
    admin = await loginAs(app, await createUser(app, { role: UserRole.ADMIN }));
  });
  afterAll(async () => app.close());

  it('lets ADMIN read an application’s history, newest first, without secrets', async () => {
    const created = await createApplication(app, sales);
    await http(app)
      .post(`/applications/${created.id}/submit`)
      .set(...bearer(sales))
      .expect(200);
    const res = await http(app)
      .get(`/audit?entityType=merchant_application&entityId=${created.id}`)
      .set(...bearer(admin))
      .expect(200);
    expect(res.body.items.map((i: { action: string }) => i.action)).toEqual([
      'APPLICATION_SUBMITTED',
      'APPLICATION_CREATED',
    ]);
    expect(res.body.items[1]).toMatchObject({
      actorRole: 'SALES',
      requestId: expect.any(String),
      metadata: { ownerEmail: 'j***@example.com' },
    });
    expect(JSON.stringify(res.body)).not.toContain('TEST-000123456');
  });

  it('filters by action and paginates', async () => {
    const res = await http(app)
      .get('/audit?action=APPLICATION_CREATED&pageSize=1')
      .set(...bearer(admin))
      .expect(200);
    expect(res.body).toMatchObject({ page: 1, pageSize: 1, total: expect.any(Number) });
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].action).toBe('APPLICATION_CREATED');
  });

  it.each([UserRole.SALES, UserRole.REVIEWER])('forbids %s', async (role) => {
    const token = await loginAs(app, await createUser(app, { role }));
    await http(app)
      .get('/audit')
      .set(...bearer(token))
      .expect(403);
  });
});
