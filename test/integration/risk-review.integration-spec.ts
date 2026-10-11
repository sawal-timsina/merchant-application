import { getQueueToken } from '@nestjs/bullmq';
import type { INestApplication } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import { OutboxRelay } from '../../src/core/outbox/outbox-relay';
import { UserRole } from '../../src/modules/identity/domain/user-role';
import { ProcessRiskReviewUseCase } from '../../src/modules/risk/application/process-risk-review.use-case';
import { KYB_PROVIDER } from '../../src/modules/risk/domain/kyb-provider';
import { RISK_REVIEW_DLQ, riskJobId } from '../../src/modules/risk/infrastructure/queue/risk-queue';
import { createApplication } from '../utils/applications';
import { bearer, loginAs } from '../utils/auth';
import { createUser } from '../utils/factories';
import { ScriptedKybProvider } from '../utils/scripted-kyb';
import { createTestApp, http } from '../utils/test-app';
import { waitFor } from '../utils/wait-for';
import { setStatus } from '../utils/workflow';

describe('Asynchronous risk review', () => {
  let app: INestApplication;
  let kyb: ScriptedKybProvider;
  let sales: string;
  let admin: string;

  beforeAll(async () => {
    kyb = new ScriptedKybProvider();
    app = await createTestApp({ worker: true, overrides: [{ token: KYB_PROVIDER, value: kyb }] });
    sales = await loginAs(app, await createUser(app, { role: UserRole.SALES }));
    admin = await loginAs(app, await createUser(app, { role: UserRole.ADMIN }));
  });
  afterAll(async () => app.close());
  beforeEach(() => {
    kyb.calls = 0;
    kyb.failures = 0;
  });

  async function submitAndRelay(overrides: Record<string, unknown> = {}) {
    const created = await createApplication(app, sales, overrides);
    const res = await http(app)
      .post(`/api/v1/applications/${created.id}/submit`)
      .set(...bearer(sales))
      .expect(200);
    await app.get(OutboxRelay).relayBatch();
    return { id: created.id, requestId: res.headers['x-request-id'] as string };
  }
  const getApp = async (id: string) =>
    (
      await http(app)
        .get(`/api/v1/applications/${id}`)
        .set(...bearer(admin))
        .expect(200)
    ).body;
  const until = (id: string, predicate: (body: Record<string, unknown>) => boolean) =>
    waitFor(async () => {
      const body = await getApp(id);
      return predicate(body) && body;
    });
  const retry = (token: string, id: string) =>
    http(app)
      .post(`/api/v1/applications/${id}/risk-review/retry`)
      .set(...bearer(token));

  it('scores the submission and moves it to UNDER_REVIEW', async () => {
    const { id } = await submitAndRelay();
    const body = await until(id, (b) => b.status === 'UNDER_REVIEW');
    expect(body.riskStatus).toBe('COMPLETED');
    const [assessment] = await app
      .get(DataSource)
      .query(
        `SELECT status, score, level, attempts, provider_reference FROM risk_assessments WHERE application_id = $1`,
        [id],
      );
    expect(assessment).toMatchObject({
      status: 'COMPLETED',
      level: 'LOW',
      attempts: 1,
      provider_reference: 'kyb_scripted',
    });
  });

  it('retries transient provider failures with backoff', async () => {
    kyb.failures = 2;
    const { id } = await submitAndRelay();
    await until(id, (b) => b.status === 'UNDER_REVIEW');
    expect(kyb.calls).toBe(3);
  });

  it('is idempotent: running the same job twice changes nothing the second time', async () => {
    const { id } = await submitAndRelay();
    await until(id, (b) => b.status === 'UNDER_REVIEW');
    const result = await app
      .get(ProcessRiskReviewUseCase)
      .execute({ applicationId: id, submissionVersion: 1, correlationId: null });
    expect(result).toBe('already-completed');
    const [{ count }] = await app
      .get(DataSource)
      .query(`SELECT count(*)::int AS count FROM risk_assessments WHERE application_id = $1`, [id]);
    expect(count).toBe(1);
  });

  it('skips a stale job from an earlier submission', async () => {
    const { id } = await submitAndRelay();
    await until(id, (b) => b.status === 'UNDER_REVIEW');
    await setStatus(app, id, 'SUBMITTED', { submissionVersion: 2, riskStatus: 'PENDING' });
    const result = await app
      .get(ProcessRiskReviewUseCase)
      .execute({ applicationId: id, submissionVersion: 1, correlationId: null });
    expect(result).toBe('stale');
    expect((await getApp(id)).status).toBe('SUBMITTED');
  });

  it('marks the review FAILED and dead-letters the job after the last attempt; ADMIN can retry', async () => {
    kyb.failures = Number.POSITIVE_INFINITY;
    const { id } = await submitAndRelay();
    await until(id, (b) => b.riskStatus === 'FAILED');
    const dlq = app.get<Queue>(getQueueToken(RISK_REVIEW_DLQ));
    await waitFor(() => dlq.getJob(riskJobId(id, 1)));

    kyb.failures = 0;
    await retry(admin, id).expect(202);
    await app.get(OutboxRelay).relayBatch();
    await until(id, (b) => b.status === 'UNDER_REVIEW');
  });

  it('allows retry only for FAILED reviews and only for ADMIN', async () => {
    const { id } = await submitAndRelay();
    await until(id, (b) => b.status === 'UNDER_REVIEW');
    await retry(admin, id).expect(409);
    await retry(sales, id).expect(403);
  });

  it('audits completion as a system action with the originating request id', async () => {
    const { id, requestId } = await submitAndRelay();
    await until(id, (b) => b.status === 'UNDER_REVIEW');
    const [row] = await app
      .get(DataSource)
      .query(
        `SELECT actor_id, request_id FROM audit_logs WHERE action = 'RISK_REVIEW_COMPLETED' AND entity_id = $1`,
        [id],
      );
    expect(row).toEqual({ actor_id: null, request_id: requestId });
  });
});
