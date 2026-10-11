import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserRole } from '../../src/modules/identity/domain/user-role';
import { createApplication } from '../utils/applications';
import { bearer, loginAs } from '../utils/auth';
import { createUser } from '../utils/factories';
import { createTestApp, http } from '../utils/test-app';
import { setStatus } from '../utils/workflow';

describe('Review decisions', () => {
  let app: INestApplication;
  let sales: string;
  let admin: string;
  let reviewer: { id: string; token: string };
  let otherReviewer: string;

  beforeAll(async () => {
    app = await createTestApp();
    sales = await loginAs(app, await createUser(app, { role: UserRole.SALES }));
    admin = await loginAs(app, await createUser(app, { role: UserRole.ADMIN }));
    const r = await createUser(app, { role: UserRole.REVIEWER });
    reviewer = { id: r.id, token: await loginAs(app, r) };
    otherReviewer = await loginAs(app, await createUser(app, { role: UserRole.REVIEWER }));
  });
  afterAll(async () => app.close());

  async function underReview() {
    const created = await createApplication(app, sales);
    await setStatus(app, created.id, 'UNDER_REVIEW', {
      riskStatus: 'COMPLETED',
      submissionVersion: 1,
      assignedReviewerId: reviewer.id,
    });
    return created.id;
  }
  const decide = (token: string, id: string, body: object) =>
    http(app)
      .post(`/api/v1/applications/${id}/decision`)
      .set(...bearer(token))
      .send(body);
  const decisionCount = async (id: string) => {
    const [{ count }] = await app
      .get(DataSource)
      .query(`SELECT count(*)::int AS count FROM review_decisions WHERE application_id = $1`, [id]);
    return count as number;
  };

  it('lets the assigned reviewer approve, recording history and decidedAt', async () => {
    const id = await underReview();
    const res = await decide(reviewer.token, id, { decision: 'APPROVE' }).expect(200);
    expect(res.body).toMatchObject({ status: 'APPROVED', decidedAt: expect.any(String) });
    const rows = await app
      .get(DataSource)
      .query(`SELECT decision, reviewer_id FROM review_decisions WHERE application_id = $1`, [id]);
    expect(rows).toEqual([{ decision: 'APPROVE', reviewer_id: reviewer.id }]);
  });

  it('request-info sends it back for editing without setting decidedAt', async () => {
    const id = await underReview();
    const res = await decide(reviewer.token, id, {
      decision: 'REQUEST_INFO',
      reason: 'Please upload the PAN certificate.',
    }).expect(200);
    expect(res.body).toMatchObject({ status: 'INFO_REQUESTED', decidedAt: null });
  });

  it.each(['REJECT', 'REQUEST_INFO'])('requires a reason for %s', async (decision) => {
    const id = await underReview();
    await decide(reviewer.token, id, { decision }).expect(422);
    await decide(reviewer.token, id, { decision, reason: 'short' }).expect(422);
    expect(await decisionCount(id)).toBe(0);
  });

  it('hides the application from a reviewer who is not assigned (404)', async () => {
    const id = await underReview();
    await decide(otherReviewer, id, { decision: 'APPROVE' }).expect(404);
  });

  it('forbids ADMIN and the owning SALES user (403)', async () => {
    const id = await underReview();
    await decide(admin, id, { decision: 'APPROVE' }).expect(403);
    await decide(sales, id, { decision: 'APPROVE' }).expect(403);
  });

  it('refuses decisions before risk review completes and after a final decision', async () => {
    const created = await createApplication(app, sales);
    await setStatus(app, created.id, 'SUBMITTED', {
      riskStatus: 'PENDING',
      assignedReviewerId: reviewer.id,
    });
    await decide(reviewer.token, created.id, { decision: 'APPROVE' }).expect(409);

    const id = await underReview();
    await decide(reviewer.token, id, { decision: 'APPROVE' }).expect(200);
    await decide(reviewer.token, id, {
      decision: 'REJECT',
      reason: 'Changed my mind entirely.',
    }).expect(409);
  });

  it('lets exactly one of two concurrent decisions win', async () => {
    const id = await underReview();
    const results = await Promise.all([
      decide(reviewer.token, id, { decision: 'APPROVE' }),
      decide(reviewer.token, id, { decision: 'REJECT', reason: 'Conflicting decision test.' }),
    ]);
    expect(results.map((r) => r.status).toSorted()).toEqual([200, 409]);
    expect(await decisionCount(id)).toBe(1);
  });

  it('rejects an unknown decision value', async () => {
    const id = await underReview();
    await decide(reviewer.token, id, { decision: 'MAYBE' }).expect(400);
  });

  it('audits the decision with the transition', async () => {
    const id = await underReview();
    await decide(reviewer.token, id, { decision: 'APPROVE' }).expect(200);
    const [row] = await app
      .get(DataSource)
      .query(
        `SELECT actor_id, metadata FROM audit_logs WHERE action = 'APPLICATION_DECISION_RECORDED' AND entity_id = $1`,
        [id],
      );
    expect(row).toEqual({
      actor_id: reviewer.id,
      metadata: { decision: 'APPROVE', from: 'UNDER_REVIEW', to: 'APPROVED' },
    });
  });
});
