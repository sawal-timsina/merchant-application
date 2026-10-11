import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { OutboxRelay } from '../../src/core/outbox/outbox-relay';
import { UserRole } from '../../src/modules/identity/domain/user-role';
import { RiskReviewReaper } from '../../src/modules/risk/application/risk-review-reaper';
import { KYB_PROVIDER } from '../../src/modules/risk/domain/kyb-provider';
import { createApplication } from '../utils/applications';
import { bearer, loginAs } from '../utils/auth';
import { createUser } from '../utils/factories';
import { ScriptedKybProvider } from '../utils/scripted-kyb';
import { createTestApp, http } from '../utils/test-app';
import { waitFor } from '../utils/wait-for';
import { setStatus } from '../utils/workflow';

const HOUR_AGO = () => new Date(Date.now() - 60 * 60_000);

describe('Risk review reaper', () => {
  let app: INestApplication;
  let sales: string;
  const kyb = new ScriptedKybProvider();
  beforeAll(async () => {
    app = await createTestApp({ worker: true, overrides: [{ token: KYB_PROVIDER, value: kyb }] });
    sales = await loginAs(app, await createUser(app, { role: UserRole.SALES }));
  });
  afterAll(async () => app.close());

  const riskStatusOf = async (id: string) =>
    (
      await app
        .get(DataSource)
        .query(`SELECT risk_status FROM merchant_applications WHERE id = $1`, [id])
    )[0].risk_status as string;

  const pendingEvents = (id: string) =>
    app
      .get(DataSource)
      .query(
        `SELECT event_type FROM outbox_events WHERE aggregate_id = $1 AND processed_at IS NULL`,
        [id],
      );

  it('re-publishes a long-pending review whose job is missing', async () => {
    const created = await createApplication(app, sales);
    // A lost job: pending for an hour, nothing in Redis, no outbox event.
    await setStatus(app, created.id, 'SUBMITTED', {
      riskStatus: 'PENDING',
      submissionVersion: 1,
      submittedAt: HOUR_AGO(),
    });

    const result = await app.get(RiskReviewReaper).reap(15 * 60_000);
    expect(result.requeued).toBeGreaterThanOrEqual(1);
    expect(await pendingEvents(created.id)).toEqual([{ event_type: 'RiskReviewRequested' }]);
  });

  it('does not re-publish twice while an event is still waiting in the outbox', async () => {
    const created = await createApplication(app, sales);
    await setStatus(app, created.id, 'SUBMITTED', {
      riskStatus: 'PENDING',
      submissionVersion: 1,
      submittedAt: HOUR_AGO(),
    });
    await app.get(RiskReviewReaper).reap(15 * 60_000);
    await app.get(RiskReviewReaper).reap(15 * 60_000);
    expect(await pendingEvents(created.id)).toHaveLength(1);
  });

  it('records a final failure whose failed-handler never ran', async () => {
    kyb.failures = Number.POSITIVE_INFINITY;
    const created = await createApplication(app, sales);
    await http(app)
      .post(`/api/v1/applications/${created.id}/submit`)
      .set(...bearer(sales))
      .expect(200);
    await app.get(OutboxRelay).relayBatch();
    await waitFor(async () => (await riskStatusOf(created.id)) === 'FAILED');

    // Simulate the crash: retries are exhausted in Redis but the database never heard about it.
    await setStatus(app, created.id, 'SUBMITTED', {
      riskStatus: 'PENDING',
      submittedAt: HOUR_AGO(),
    });

    const result = await app.get(RiskReviewReaper).reap(15 * 60_000);
    expect(result.failed).toBeGreaterThanOrEqual(1);
    expect(await riskStatusOf(created.id)).toBe('FAILED');
  });

  it('leaves recent submissions alone', async () => {
    const created = await createApplication(app, sales);
    await setStatus(app, created.id, 'SUBMITTED', {
      riskStatus: 'PENDING',
      submissionVersion: 1,
      submittedAt: new Date(),
    });
    await app.get(RiskReviewReaper).reap(15 * 60_000);
    expect(await pendingEvents(created.id)).toHaveLength(0);
  });
});
