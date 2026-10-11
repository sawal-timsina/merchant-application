import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserRole } from '../../src/modules/identity/domain/user-role';
import { createApplication } from '../utils/applications';
import { bearer, loginAs } from '../utils/auth';
import { createUser } from '../utils/factories';
import { createTestApp, http } from '../utils/test-app';
import { setStatus } from '../utils/workflow';

describe('Submit application', () => {
  let app: INestApplication;
  let sales: string;
  let otherSales: string;

  beforeAll(async () => {
    app = await createTestApp();
    sales = await loginAs(app, await createUser(app, { role: UserRole.SALES }));
    otherSales = await loginAs(app, await createUser(app, { role: UserRole.SALES }));
  });
  afterAll(async () => app.close());

  const submit = (token: string, id: string) =>
    http(app)
      .post(`/api/v1/applications/${id}/submit`)
      .set(...bearer(token));
  const outboxCount = async (id: string) => {
    const [{ count }] = await app
      .get(DataSource)
      .query(`SELECT count(*)::int AS count FROM outbox_events WHERE aggregate_id = $1`, [id]);
    return count as number;
  };

  it('moves DRAFT to SUBMITTED, starts risk review and writes an outbox event atomically', async () => {
    const created = await createApplication(app, sales);
    const res = await submit(sales, created.id).expect(200);
    expect(res.body).toMatchObject({
      status: 'SUBMITTED',
      riskStatus: 'PENDING',
      submissionVersion: 1,
    });
    expect(res.body.submittedAt).toEqual(expect.any(String));

    const events = await app
      .get(DataSource)
      .query(
        `SELECT event_type, payload, correlation_id FROM outbox_events WHERE aggregate_id = $1`,
        [created.id],
      );
    expect(events).toEqual([
      {
        event_type: 'RiskReviewRequested',
        payload: { applicationId: created.id, submissionVersion: 1 },
        correlation_id: res.headers['x-request-id'],
      },
    ]);
  });

  it('requires a tax id before submission and writes no event when refused', async () => {
    const created = await createApplication(app, sales, { taxIdType: undefined, taxId: undefined });
    await submit(sales, created.id).expect(422);
    expect(await outboxCount(created.id)).toBe(0);
  });

  it('rejects submitting twice', async () => {
    const created = await createApplication(app, sales);
    await submit(sales, created.id).expect(200);
    await submit(sales, created.id).expect(409);
  });

  it('lets exactly one of two concurrent submits win', async () => {
    const created = await createApplication(app, sales);
    const results = await Promise.all([submit(sales, created.id), submit(sales, created.id)]);
    expect(results.map((r) => r.status).toSorted()).toEqual([200, 409]);
    expect(await outboxCount(created.id)).toBe(1);
  });

  it('resubmission after INFO_REQUESTED increments the submission version', async () => {
    const created = await createApplication(app, sales);
    await submit(sales, created.id).expect(200);
    await setStatus(app, created.id, 'INFO_REQUESTED');
    const res = await submit(sales, created.id).expect(200);
    expect(res.body.submissionVersion).toBe(2);
  });

  it('hides other users’ applications', async () => {
    const created = await createApplication(app, sales);
    await submit(otherSales, created.id).expect(404);
  });
});
