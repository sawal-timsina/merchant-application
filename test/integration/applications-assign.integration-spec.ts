import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserRole } from '../../src/modules/identity/domain/user-role';
import { createApplication } from '../utils/applications';
import { bearer, loginAs } from '../utils/auth';
import { createUser } from '../utils/factories';
import { createTestApp, http } from '../utils/test-app';
import { setStatus } from '../utils/workflow';

describe('Assign reviewer', () => {
  let app: INestApplication;
  let sales: string;
  let admin: string;
  let reviewerUser: Awaited<ReturnType<typeof createUser>>;

  beforeAll(async () => {
    app = await createTestApp();
    sales = await loginAs(app, await createUser(app, { role: UserRole.SALES }));
    admin = await loginAs(app, await createUser(app, { role: UserRole.ADMIN }));
    reviewerUser = await createUser(app, { role: UserRole.REVIEWER });
  });
  afterAll(async () => app.close());

  const assign = (token: string, id: string, reviewerId: string) =>
    http(app)
      .post(`/api/v1/applications/${id}/assign`)
      .set(...bearer(token))
      .send({ reviewerId });

  async function submitted() {
    const created = await createApplication(app, sales);
    await setStatus(app, created.id, 'SUBMITTED');
    return created.id;
  }

  it('lets ADMIN assign a REVIEWER, who can then read the application', async () => {
    const id = await submitted();
    const res = await assign(admin, id, reviewerUser.id).expect(200);
    expect(res.body.assignedReviewerId).toBe(reviewerUser.id);
    const reviewerToken = await loginAs(app, reviewerUser);
    await http(app)
      .get(`/api/v1/applications/${id}`)
      .set(...bearer(reviewerToken))
      .expect(200);
  });

  it('forbids SALES from assigning', async () => {
    await assign(sales, await submitted(), reviewerUser.id).expect(403);
  });

  it('rejects assigning a non-reviewer or an inactive reviewer', async () => {
    const id = await submitted();
    const salesUser = await createUser(app, { role: UserRole.SALES });
    const inactive = await createUser(app, { role: UserRole.REVIEWER, isActive: false });
    await assign(admin, id, salesUser.id).expect(422);
    await assign(admin, id, inactive.id).expect(422);
  });

  it('rejects a malformed reviewer id', async () => {
    await assign(admin, await submitted(), 'not-a-uuid').expect(400);
  });

  it('rejects assignment while DRAFT or after a final decision', async () => {
    const draft = await createApplication(app, sales);
    await assign(admin, draft.id, reviewerUser.id).expect(409);
    const approved = await createApplication(app, sales);
    await setStatus(app, approved.id, 'APPROVED');
    await assign(admin, approved.id, reviewerUser.id).expect(409);
  });

  it('records an audit entry with the previous reviewer', async () => {
    const id = await submitted();
    await assign(admin, id, reviewerUser.id).expect(200);
    const [row] = await app
      .get(DataSource)
      .query(
        `SELECT actor_role, metadata FROM audit_logs WHERE action = 'APPLICATION_REVIEWER_ASSIGNED' AND entity_id = $1`,
        [id],
      );
    expect(row).toEqual({
      actor_role: 'ADMIN',
      metadata: { reviewerId: reviewerUser.id, previousReviewerId: null },
    });
  });
});
