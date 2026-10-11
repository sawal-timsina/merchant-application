import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserRole } from '../../src/modules/identity/domain/user-role';
import { createApplication } from '../utils/applications';
import { bearer, loginAs } from '../utils/auth';
import { createUser } from '../utils/factories';
import { createTestApp, http } from '../utils/test-app';
import { setStatus } from '../utils/workflow';

const newUser = (overrides: Record<string, unknown> = {}) => ({
  email: `new-${randomUUID()}@example.com`,
  fullName: 'New Person',
  role: 'SALES',
  password: 'initial-password-123',
  ...overrides,
});

describe('User management', () => {
  let app: INestApplication;
  let admin: string;
  beforeAll(async () => {
    app = await createTestApp();
    admin = await loginAs(app, await createUser(app, { role: UserRole.ADMIN }));
  });
  afterAll(async () => app.close());

  const create = (token: string, body: object) =>
    http(app)
      .post('/api/v1/users')
      .set(...bearer(token))
      .send(body);

  it('lets ADMIN create a SALES user who can then log in', async () => {
    const body = newUser();
    const res = await create(admin, body).expect(201);
    expect(res.body).toEqual({
      id: expect.any(String),
      email: body.email,
      fullName: 'New Person',
      role: 'SALES',
      isActive: true,
      createdAt: expect.any(String),
    });
    expect(JSON.stringify(res.body)).not.toContain(body.password);
    await loginAs(app, { email: body.email, password: body.password });
  });

  it('creates a REVIEWER who can be assigned to an application', async () => {
    const res = await create(admin, newUser({ role: 'REVIEWER' })).expect(201);
    const sales = await loginAs(app, await createUser(app, { role: UserRole.SALES }));
    const application = await createApplication(app, sales);
    await setStatus(app, application.id, 'SUBMITTED');
    await http(app)
      .post(`/api/v1/applications/${application.id}/assign`)
      .set(...bearer(admin))
      .send({ reviewerId: res.body.id })
      .expect(200);
  });

  it('stores only an argon2id hash of the password', async () => {
    const body = newUser();
    const res = await create(admin, body).expect(201);
    const [row] = await app
      .get(DataSource)
      .query(`SELECT password_hash FROM users WHERE id = $1`, [res.body.id]);
    expect(row.password_hash).toMatch(/^\$argon2id\$/);
  });

  it('rejects a duplicate email, case-insensitively, with 409', async () => {
    const body = newUser();
    await create(admin, body).expect(201);
    await create(admin, newUser({ email: body.email.toUpperCase() })).expect(409);
  });

  it.each([
    ['ADMIN role', { role: 'ADMIN' }],
    ['unknown role', { role: 'ROOT' }],
    ['short password', { password: 'short' }],
    ['invalid email', { email: 'not-an-email' }],
    ['missing name', { fullName: '' }],
    ['extra fields', { isActive: false }],
  ])('rejects %s with 400', async (_name, overrides) => {
    await create(admin, newUser(overrides)).expect(400);
  });

  it.each([UserRole.SALES, UserRole.REVIEWER])('forbids %s from creating users', async (role) => {
    const token = await loginAs(app, await createUser(app, { role }));
    await create(token, newUser()).expect(403);
  });

  it('audits creation without the password', async () => {
    const body = newUser({ role: 'REVIEWER' });
    const res = await create(admin, body).expect(201);
    const [row] = await app
      .get(DataSource)
      .query(
        `SELECT actor_role, metadata FROM audit_logs WHERE action = 'USER_CREATED' AND entity_id = $1`,
        [res.body.id],
      );
    expect(row.actor_role).toBe('ADMIN');
    expect(row.metadata).toMatchObject({ role: 'REVIEWER' });
    expect(JSON.stringify(row.metadata)).not.toContain(body.password);
  });

  describe('GET /users', () => {
    it('lists users filtered by role, newest first, without password hashes', async () => {
      const reviewer = (await create(admin, newUser({ role: 'REVIEWER' })).expect(201)).body;
      const res = await http(app)
        .get('/api/v1/users?role=REVIEWER&pageSize=100')
        .set(...bearer(admin))
        .expect(200);
      expect(res.body).toMatchObject({ page: 1, pageSize: 100, total: expect.any(Number) });
      expect(res.body.items.every((u: { role: string }) => u.role === 'REVIEWER')).toBe(true);
      expect(res.body.items.map((u: { id: string }) => u.id)).toContain(reviewer.id);
      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|password_hash|argon2/);
    });

    it.each(['role=BOGUS', 'pageSize=101'])('rejects ?%s', async (query) => {
      await http(app)
        .get(`/api/v1/users?${query}`)
        .set(...bearer(admin))
        .expect(400);
    });

    it('is ADMIN only', async () => {
      const token = await loginAs(app, await createUser(app, { role: UserRole.SALES }));
      await http(app)
        .get('/api/v1/users')
        .set(...bearer(token))
        .expect(403);
    });
  });

  const patch = (token: string, id: string, body: object) =>
    http(app)
      .patch(`/api/v1/users/${id}`)
      .set(...bearer(token))
      .send(body);
  const auditCount = async (id: string, action: string) => {
    const [{ count }] = await app
      .get(DataSource)
      .query(`SELECT count(*)::int AS count FROM audit_logs WHERE action = $2 AND entity_id = $1`, [
        id,
        action,
      ]);
    return count as number;
  };

  describe('PATCH /users/:id', () => {
    it('deactivates a user: their access token and refresh token stop working', async () => {
      const body = newUser();
      const created = (await create(admin, body).expect(201)).body;
      const login = await http(app)
        .post('/api/v1/auth/login')
        .send({ email: body.email, password: body.password })
        .expect(200);

      const res = await patch(admin, created.id, { isActive: false }).expect(200);
      expect(res.body).toMatchObject({ id: created.id, isActive: false });

      await http(app)
        .get('/api/v1/auth/me')
        .set(...bearer(login.body.accessToken))
        .expect(401);
      await http(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: login.body.refreshToken })
        .expect(401);
      await http(app)
        .post('/api/v1/auth/login')
        .send({ email: body.email, password: body.password })
        .expect(401);
      const [{ open }] = await app
        .get(DataSource)
        .query(
          `SELECT count(*)::int AS open FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL`,
          [created.id],
        );
      expect(open).toBe(0);
      expect(await auditCount(created.id, 'USER_DEACTIVATED')).toBe(1);
    });

    it('reactivates a user, who can then log in again', async () => {
      const body = newUser({ role: 'REVIEWER' });
      const created = (await create(admin, body).expect(201)).body;
      await patch(admin, created.id, { isActive: false }).expect(200);
      await patch(admin, created.id, { isActive: true }).expect(200);
      await loginAs(app, { email: body.email, password: body.password });
      expect(await auditCount(created.id, 'USER_REACTIVATED')).toBe(1);
    });

    it('treats setting the current state as a no-op without an audit entry', async () => {
      const created = (await create(admin, newUser()).expect(201)).body;
      await patch(admin, created.id, { isActive: true }).expect(200);
      expect(await auditCount(created.id, 'USER_REACTIVATED')).toBe(0);
    });

    it('refuses to change ADMIN accounts, including the caller’s own', async () => {
      const other = await createUser(app, { role: UserRole.ADMIN });
      await patch(admin, other.id, { isActive: false }).expect(403);
      const me = (
        await http(app)
          .get('/api/v1/auth/me')
          .set(...bearer(admin))
      ).body;
      await patch(admin, me.id, { isActive: false }).expect(403);
    });

    it.each([
      ['missing isActive', {}],
      ['non-boolean isActive', { isActive: 'no' }],
      ['other fields', { isActive: false, role: 'ADMIN' }],
    ])('rejects %s with 400', async (_name, body) => {
      const created = (await create(admin, newUser()).expect(201)).body;
      await patch(admin, created.id, body).expect(400);
    });

    it('returns 404 for an unknown user and 400 for a malformed id', async () => {
      await patch(admin, randomUUID(), { isActive: false }).expect(404);
      await patch(admin, 'not-a-uuid', { isActive: false }).expect(400);
    });

    it('is ADMIN only', async () => {
      const created = (await create(admin, newUser()).expect(201)).body;
      const token = await loginAs(app, await createUser(app, { role: UserRole.SALES }));
      await patch(token, created.id, { isActive: false }).expect(403);
    });
  });
});
