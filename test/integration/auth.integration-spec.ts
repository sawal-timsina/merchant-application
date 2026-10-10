import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserRole } from '../../src/modules/identity/domain/user-role';
import { User } from '../../src/modules/identity/infrastructure/persistence/user.entity';
import { bearer, loginAs } from '../utils/auth';
import { createUser } from '../utils/factories';
import { createTestApp, http } from '../utils/test-app';

describe('Authentication', () => {
  let app: INestApplication;
  beforeAll(async () => (app = await createTestApp()));
  afterAll(async () => app.close());

  const login = (email: string, password: string) =>
    http(app).post('/auth/login').send({ email, password });

  it('issues an access and refresh token for valid credentials', async () => {
    const user = await createUser(app);
    const res = await login(user.email, user.password).expect(200);
    expect(res.body).toEqual({
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
      tokenType: 'Bearer',
      expiresIn: 900,
    });
  });

  it('treats email case-insensitively', async () => {
    const user = await createUser(app);
    await login(user.email.toUpperCase(), user.password).expect(200);
  });

  it('gives the same 401 for a wrong password and an unknown email', async () => {
    const user = await createUser(app);
    const wrong = await login(user.email, 'nope-nope-nope').expect(401);
    const unknown = await login('ghost@example.com', 'nope-nope-nope').expect(401);
    expect(wrong.body.message).toBe(unknown.body.message);
  });

  it('rejects inactive users at login', async () => {
    const user = await createUser(app, { isActive: false });
    await login(user.email, user.password).expect(401);
  });

  it('protects routes by default', async () => {
    await http(app).get('/auth/me').expect(401);
    await http(app)
      .get('/auth/me')
      .set(...bearer('garbage'))
      .expect(401);
  });

  it('returns the current user without sensitive fields', async () => {
    const user = await createUser(app, { role: UserRole.REVIEWER });
    const token = await loginAs(app, user);
    const res = await http(app)
      .get('/auth/me')
      .set(...bearer(token))
      .expect(200);
    expect(res.body).toEqual({
      id: user.id,
      email: user.email,
      fullName: 'Test REVIEWER',
      role: 'REVIEWER',
    });
  });

  it('rejects a still-valid token once the user is deactivated', async () => {
    const user = await createUser(app);
    const token = await loginAs(app, user);
    await app.get(DataSource).getRepository(User).update(user.id, { isActive: false });
    await http(app)
      .get('/auth/me')
      .set(...bearer(token))
      .expect(401);
  });

  it('audits failed logins with a masked email and without the password', async () => {
    const user = await createUser(app);
    await login(user.email, 'wrong-password-1').expect(401);
    const masked = `${user.email[0]}***${user.email.slice(user.email.indexOf('@'))}`;
    const rows = await app
      .get(DataSource)
      .query(
        `SELECT metadata FROM audit_logs WHERE action = 'AUTH_LOGIN_FAILED' AND entity_id = $1`,
        [user.id],
      );
    expect(rows).toHaveLength(1);
    expect(rows[0].metadata.email).toBe(masked);
    expect(JSON.stringify(rows[0].metadata)).not.toContain('wrong-password-1');
  });

  it('keeps the health check public', async () => {
    await http(app).get('/health').expect(200);
  });

  it('validates the login body', async () => {
    await http(app).post('/auth/login').send({ email: 'not-an-email' }).expect(400);
  });
});
