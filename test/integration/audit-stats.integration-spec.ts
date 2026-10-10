import type { INestApplication } from '@nestjs/common';
import { UserRole } from '../../src/modules/identity/domain/user-role';
import { createApplication } from '../utils/applications';
import { findAuditEntries } from '../utils/audit';
import { bearer, loginAs } from '../utils/auth';
import { createUser } from '../utils/factories';
import { createTestApp, http } from '../utils/test-app';
import { setStatus } from '../utils/workflow';

// Runs in both the `integration` (Postgres) and `integration-mongo` projects.
describe(`Decision stats (${process.env.AUDIT_STORE ?? 'postgres'} store)`, () => {
  let app: INestApplication;
  let admin: string;
  beforeAll(async () => {
    app = await createTestApp({ worker: true });
    admin = await loginAs(app, await createUser(app, { role: UserRole.ADMIN }));
  });
  afterAll(async () => app.close());

  const stats = (query: string) =>
    http(app)
      .get(`/audit/stats/decisions?${query}`)
      .set(...bearer(admin));

  it('counts each reviewer’s decisions per day by outcome', async () => {
    const sales = await loginAs(app, await createUser(app, { role: UserRole.SALES }));
    const reviewerUser = await createUser(app, { role: UserRole.REVIEWER });
    const reviewer = await loginAs(app, reviewerUser);
    const decisions = [
      { decision: 'APPROVE' },
      { decision: 'APPROVE' },
      { decision: 'REJECT', reason: 'Insufficient documentation provided.' },
    ];
    for (const body of decisions) {
      const created = await createApplication(app, sales);
      await setStatus(app, created.id, 'UNDER_REVIEW', {
        riskStatus: 'COMPLETED',
        submissionVersion: 1,
        assignedReviewerId: reviewerUser.id,
      });
      await http(app)
        .post(`/applications/${created.id}/decision`)
        .set(...bearer(reviewer))
        .send(body)
        .expect(200);
    }
    await findAuditEntries(app, { action: 'APPLICATION_DECISION_RECORDED' }); // Mongo: project

    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const res = await stats(`from=${today}&to=${tomorrow}`).expect(200);
    expect(res.body).toContainEqual({
      day: today,
      reviewerId: reviewerUser.id,
      approved: 2,
      rejected: 1,
      infoRequested: 0,
      total: 3,
    });
  });

  it.each([
    ['from after to', 'from=2026-01-02&to=2026-01-01', 422],
    ['range over 366 days', 'from=2024-01-01&to=2026-01-01', 422],
    ['malformed date', 'from=nope&to=2026-01-01', 400],
  ])('rejects %s', async (_name, query, status) => {
    await stats(query).expect(status);
  });

  it('is ADMIN only', async () => {
    const sales = await loginAs(app, await createUser(app, { role: UserRole.SALES }));
    await http(app)
      .get('/audit/stats/decisions?from=2026-01-01&to=2026-01-02')
      .set(...bearer(sales))
      .expect(403);
  });
});
