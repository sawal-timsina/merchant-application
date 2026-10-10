import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { OutboxRelay } from '../../src/core/outbox/outbox-relay';
import { UserRole } from '../../src/modules/identity/domain/user-role';
import { ProcessRiskReviewUseCase } from '../../src/modules/risk/application/process-risk-review.use-case';
import { RiskReviewReaper } from '../../src/modules/risk/application/risk-review-reaper';
import { CALLBACK_KYB_PROVIDER, KYB_MODE } from '../../src/modules/risk/domain/kyb-provider';
import { createApplication } from '../utils/applications';
import { bearer, loginAs } from '../utils/auth';
import { createUser } from '../utils/factories';
import { createTestApp, http } from '../utils/test-app';
import { waitFor } from '../utils/wait-for';
import { signedKybRequest } from '../utils/webhooks';
import { setStatus } from '../utils/workflow';

class RecordingCallbackProvider {
  requests: string[] = [];
  async requestVerification(req: { applicationId: string }) {
    const reference = `kyb_cb_${req.applicationId}_${this.requests.length}`;
    this.requests.push(reference);
    return { reference };
  }
}

const event = (
  reference: string,
  eventId = `evt_${reference}`,
  data = { businessVerified: true, watchlistHit: false },
) => ({
  eventId,
  type: 'kyb.verification.completed',
  reference,
  data,
  occurredAt: new Date().toISOString(),
});

describe('KYB callback webhook', () => {
  let app: INestApplication;
  let provider: RecordingCallbackProvider;
  let sales: string;
  let admin: string;

  beforeAll(async () => {
    provider = new RecordingCallbackProvider();
    app = await createTestApp({
      worker: true,
      overrides: [
        { token: KYB_MODE, value: 'callback' },
        { token: CALLBACK_KYB_PROVIDER, value: provider },
      ],
    });
    sales = await loginAs(app, await createUser(app, { role: UserRole.SALES }));
    admin = await loginAs(app, await createUser(app, { role: UserRole.ADMIN }));
  });
  afterAll(async () => app.close());

  async function awaitingCallback() {
    const created = await createApplication(app, sales);
    await http(app)
      .post(`/applications/${created.id}/submit`)
      .set(...bearer(sales))
      .expect(200);
    await app.get(OutboxRelay).relayBatch();
    const reference = await waitFor(async () => {
      const rows = await app
        .get(DataSource)
        .query(
          `SELECT provider_reference FROM risk_assessments WHERE application_id = $1 AND status = 'AWAITING_CALLBACK'`,
          [created.id],
        );
      return rows[0]?.provider_reference as string | undefined;
    });
    return { id: created.id, reference };
  }
  const applicationOf = async (id: string) =>
    (
      await http(app)
        .get(`/applications/${id}`)
        .set(...bearer(admin))
    ).body as { status: string; riskStatus: string };

  it('completes the review when the provider calls back', async () => {
    const { id, reference } = await awaitingCallback();
    expect((await applicationOf(id)).status).toBe('SUBMITTED');
    const res = await signedKybRequest(app, event(reference)).expect(200);
    expect(res.body).toEqual({ status: 'processed' });
    expect(await applicationOf(id)).toMatchObject({
      status: 'UNDER_REVIEW',
      riskStatus: 'COMPLETED',
    });
  });

  it('processes a redelivered event only once, even concurrently', async () => {
    const { id, reference } = await awaitingCallback();
    const body = event(reference);
    const [a, b] = await Promise.all([signedKybRequest(app, body), signedKybRequest(app, body)]);
    expect([a.body.status, b.body.status].toSorted()).toEqual(['duplicate', 'processed']);
    const [{ count }] = await app
      .get(DataSource)
      .query(
        `SELECT count(*)::int AS count FROM audit_logs WHERE action = 'RISK_REVIEW_COMPLETED' AND entity_id = $1`,
        [id],
      );
    expect(count).toBe(1);
  });

  it.each([
    ['a stale timestamp', { timestamp: Math.floor(Date.now() / 1000) - 3600 }],
    ['the wrong secret', { secret: 'z'.repeat(64) }],
  ])('rejects %s with 401 and stores nothing', async (_name, opts) => {
    const { reference } = await awaitingCallback();
    const body = event(reference);
    await signedKybRequest(app, body, opts).expect(401);
    const rows = await app
      .get(DataSource)
      .query(`SELECT 1 FROM webhook_events WHERE event_id = $1`, [body.eventId]);
    expect(rows).toHaveLength(0);
  });

  it('rejects a body that differs from what was signed', async () => {
    const { reference } = await awaitingCallback();
    const signed = event(reference);
    const tampered = JSON.stringify({
      ...signed,
      data: { businessVerified: true, watchlistHit: true },
    });
    await signedKybRequest(app, signed, { rawOverride: tampered }).expect(401);
  });

  it('rejects unsigned requests before validating the body', async () => {
    await http(app).post('/webhooks/kyb').send({ nonsense: true }).expect(401);
  });

  it('validates the body of signed requests', async () => {
    await signedKybRequest(app, { eventId: 'evt_bad', type: 'something.else' }).expect(400);
  });

  it('acknowledges but ignores unknown references and superseded submissions', async () => {
    await signedKybRequest(app, event('kyb_unknown')).expect(200, { status: 'ignored' });

    const { id, reference } = await awaitingCallback();
    await setStatus(app, id, 'SUBMITTED', { submissionVersion: 2 });
    await signedKybRequest(app, event(reference)).expect(200, { status: 'ignored' });
    expect((await applicationOf(id)).status).toBe('SUBMITTED');
  });

  it('does not request verification twice when the job is redelivered', async () => {
    const { id } = await awaitingCallback();
    const before = provider.requests.length;
    const result = await app
      .get(ProcessRiskReviewUseCase)
      .execute({ applicationId: id, submissionVersion: 1, correlationId: null });
    expect(result).toBe('awaiting-callback');
    expect(provider.requests.length).toBe(before);
  });

  it('fails the review when the callback never arrives', async () => {
    const { id } = await awaitingCallback();
    await app
      .get(DataSource)
      .query(
        `UPDATE risk_assessments SET updated_at = now() - interval '2 hours' WHERE application_id = $1`,
        [id],
      );
    const result = await app.get(RiskReviewReaper).reap(15 * 60_000);
    expect(result.failed).toBeGreaterThanOrEqual(1);
    expect((await applicationOf(id)).riskStatus).toBe('FAILED');
  });
});
