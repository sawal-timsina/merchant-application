import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserRole } from '../../src/modules/identity/domain/user-role';
import { createApplication, validApplicationPayload } from '../utils/applications';
import { bearer, loginAs } from '../utils/auth';
import { createUser } from '../utils/factories';
import { createTestApp, http } from '../utils/test-app';

describe('Applications: create, read, list, update', () => {
  let app: INestApplication;
  let salesA: string;
  let salesB: string;
  let reviewer: string;
  let admin: string;

  beforeAll(async () => {
    app = await createTestApp();
    salesA = await loginAs(app, await createUser(app, { role: UserRole.SALES }));
    salesB = await loginAs(app, await createUser(app, { role: UserRole.SALES }));
    reviewer = await loginAs(app, await createUser(app, { role: UserRole.REVIEWER }));
    admin = await loginAs(app, await createUser(app, { role: UserRole.ADMIN }));
  });
  afterAll(async () => app.close());

  const post = (token: string, body: object) =>
    http(app)
      .post('/applications')
      .set(...bearer(token))
      .send(body);
  const get = (token: string, id: string) =>
    http(app)
      .get(`/applications/${id}`)
      .set(...bearer(token));
  const patch = (token: string, id: string, body: object) =>
    http(app)
      .patch(`/applications/${id}`)
      .set(...bearer(token))
      .send(body);

  describe('create', () => {
    it('creates a DRAFT owned by the caller and never returns the tax id', async () => {
      const created = await createApplication(app, salesA);
      expect(created).toMatchObject({
        status: 'DRAFT',
        riskStatus: 'NOT_STARTED',
        version: 1,
        taxIdType: 'PAN',
        taxIdLast4: '3456',
      });
      expect(JSON.stringify(created)).not.toContain('TEST-000123456');
      expect(created).not.toHaveProperty('taxIdEncrypted');
    });

    it('stores the tax id encrypted at rest', async () => {
      const created = await createApplication(app, salesA);
      const [row] = await app
        .get(DataSource)
        .query(`SELECT tax_id_encrypted FROM merchant_applications WHERE id = $1`, [created.id]);
      expect(row.tax_id_encrypted).toMatch(/^v1\./);
      expect(row.tax_id_encrypted).not.toContain('000123456');
    });

    it('forbids REVIEWER from creating', async () => {
      await post(reviewer, validApplicationPayload()).expect(403);
    });

    it.each([
      ['status', { status: 'APPROVED' }],
      ['createdById', { createdById: '00000000-0000-0000-0000-000000000000' }],
      ['assignedReviewerId', { assignedReviewerId: '00000000-0000-0000-0000-000000000000' }],
    ])('rejects mass assignment of %s', async (_field, extra) => {
      await post(salesA, validApplicationPayload(extra)).expect(400);
    });

    it.each([
      [
        'ticket larger than volume',
        { expectedMonthlyVolumeCents: 100, averageTicketCents: 200 },
        422,
      ],
      ['tax id without type', { taxIdType: undefined }, 422],
      ['malformed MCC', { mcc: '58A2' }, 400],
      ['lowercase currency', { currency: 'npr' }, 400],
      ['fractional cents', { averageTicketCents: 10.5 }, 400],
      ['invalid phone', { ownerPhone: '12345' }, 400],
    ])('rejects %s', async (_name, overrides, status) => {
      await post(salesA, validApplicationPayload(overrides)).expect(status);
    });
  });

  describe('object-level isolation for SALES', () => {
    it('cannot read another SALES user’s application by id', async () => {
      const own = await createApplication(app, salesA);
      await get(salesB, own.id).expect(404);
    });

    it('cannot update another SALES user’s application by id', async () => {
      const own = await createApplication(app, salesA);
      await patch(salesB, own.id, { businessName: 'Hijacked', version: own.version }).expect(404);
      const res = await get(salesA, own.id).expect(200);
      expect(res.body.businessName).toBe('Himalayan Coffee');
    });

    it('lists only own applications', async () => {
      const a = await createApplication(app, salesA);
      const b = await createApplication(app, salesB);
      const res = await http(app)
        .get('/applications?pageSize=100')
        .set(...bearer(salesB))
        .expect(200);
      const ids = res.body.items.map((i: { id: string }) => i.id);
      expect(ids).toContain(b.id);
      expect(ids).not.toContain(a.id);
    });

    it('cannot see unassigned applications as a REVIEWER', async () => {
      const own = await createApplication(app, salesA);
      await get(reviewer, own.id).expect(404);
    });
  });

  describe('list', () => {
    it('filters by status and paginates newest first for ADMIN', async () => {
      await createApplication(app, salesA);
      await createApplication(app, salesA);
      const res = await http(app)
        .get('/applications?status=DRAFT&page=1&pageSize=2')
        .set(...bearer(admin))
        .expect(200);
      expect(res.body).toMatchObject({ page: 1, pageSize: 2, total: expect.any(Number) });
      expect(res.body.items).toHaveLength(2);
      expect(res.body.items.every((i: { status: string }) => i.status === 'DRAFT')).toBe(true);
      const [first, second] = res.body.items;
      expect(new Date(first.createdAt).getTime()).toBeGreaterThanOrEqual(
        new Date(second.createdAt).getTime(),
      );
    });

    it.each(['pageSize=101', 'page=0', 'status=BOGUS'])('rejects ?%s', async (query) => {
      await http(app)
        .get(`/applications?${query}`)
        .set(...bearer(admin))
        .expect(400);
    });
  });

  describe('get / update', () => {
    it('returns 400 for a malformed id', async () => {
      await get(salesA, 'not-a-uuid').expect(400);
    });

    it('updates while DRAFT and bumps the version', async () => {
      const created = await createApplication(app, salesA);
      const res = await patch(salesA, created.id, {
        businessName: 'Renamed',
        version: created.version,
      }).expect(200);
      expect(res.body).toMatchObject({ businessName: 'Renamed', version: created.version + 1 });
    });

    it('rejects a stale version with 409', async () => {
      const created = await createApplication(app, salesA);
      await patch(salesA, created.id, { businessName: 'One', version: 1 }).expect(200);
      await patch(salesA, created.id, { businessName: 'Two', version: 1 }).expect(409);
    });

    it.each(['businessName', 'currency', 'expectedMonthlyVolumeCents'])(
      'rejects null for required field %s instead of failing with 500',
      async (field) => {
        const created = await createApplication(app, salesA);
        const res = await patch(salesA, created.id, { [field]: null, version: created.version });
        expect(res.status).toBe(400);
      },
    );

    it('requires the version field', async () => {
      const created = await createApplication(app, salesA);
      await patch(salesA, created.id, { businessName: 'X' }).expect(400);
    });

    it('refuses edits once submitted', async () => {
      const created = await createApplication(app, salesA);
      await app
        .get(DataSource)
        .query(`UPDATE merchant_applications SET status = 'SUBMITTED' WHERE id = $1`, [created.id]);
      await patch(salesA, created.id, { businessName: 'Late', version: created.version }).expect(
        409,
      );
    });

    it('records audit entries with masked contact details', async () => {
      const created = await createApplication(app, salesA);
      const [row] = await app
        .get(DataSource)
        .query(
          `SELECT metadata FROM audit_logs WHERE action = 'APPLICATION_CREATED' AND entity_id = $1`,
          [created.id],
        );
      expect(row.metadata.ownerEmail).toBe('j***@example.com');
      expect(JSON.stringify(row.metadata)).not.toContain('TEST-000123456');
    });
  });
});
