import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { User } from '../../src/modules/identity/infrastructure/persistence/user.entity';
import { createUser } from '../utils/factories';
import { createTestApp, http } from '../utils/test-app';

describe('Refresh tokens', () => {
  let app: INestApplication;
  beforeAll(async () => (app = await createTestApp()));
  afterAll(async () => app.close());

  async function login() {
    const user = await createUser(app);
    const res = await http(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: user.password })
      .expect(200);
    return { user, refreshToken: res.body.refreshToken as string };
  }
  const refresh = (refreshToken: string) =>
    http(app).post('/api/v1/auth/refresh').send({ refreshToken });

  it('rotates: returns a new pair and the new token works', async () => {
    const { refreshToken } = await login();
    const res = await refresh(refreshToken).expect(200);
    expect(res.body.refreshToken).not.toBe(refreshToken);
    expect(res.body.accessToken).toEqual(expect.any(String));
    await refresh(res.body.refreshToken).expect(200);
  });

  it('revokes the whole family when a rotated token is replayed', async () => {
    const { user, refreshToken: first } = await login();
    const second = (await refresh(first).expect(200)).body.refreshToken;
    await refresh(first).expect(401); // replay of a rotated token
    await refresh(second).expect(401); // descendant revoked too
    const rows = await app
      .get(DataSource)
      .query(
        `SELECT 1 FROM audit_logs WHERE action = 'AUTH_REFRESH_REUSE_DETECTED' AND entity_id = $1`,
        [user.id],
      );
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it('lets exactly one of two concurrent refreshes succeed', async () => {
    const { refreshToken } = await login();
    const results = await Promise.all([refresh(refreshToken), refresh(refreshToken)]);
    expect(results.map((r) => r.status).toSorted()).toEqual([200, 401]);
  });

  it('rejects unknown tokens and inactive users', async () => {
    await refresh('x'.repeat(43)).expect(401);
    const { user, refreshToken } = await login();
    await app.get(DataSource).getRepository(User).update(user.id, { isActive: false });
    await refresh(refreshToken).expect(401);
  });

  it('logout revokes the family', async () => {
    const { refreshToken } = await login();
    await http(app).post('/api/v1/auth/logout').send({ refreshToken }).expect(204);
    await refresh(refreshToken).expect(401);
  });

  it('stores only token hashes', async () => {
    const { refreshToken } = await login();
    const rows = await app
      .get(DataSource)
      .query(`SELECT 1 FROM refresh_tokens WHERE token_hash = $1`, [refreshToken]);
    expect(rows).toHaveLength(0);
  });
});
