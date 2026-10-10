import type { INestApplication } from '@nestjs/common';
import { createTestApp, http } from '../utils/test-app';

describe('OpenAPI document', () => {
  let app: INestApplication;
  beforeAll(async () => (app = await createTestApp()));
  afterAll(async () => app.close());

  it('documents every route', async () => {
    const res = await http(app).get('/docs-json').expect(200);
    expect(Object.keys(res.body.paths)).toEqual(
      expect.arrayContaining([
        '/auth/login',
        '/auth/refresh',
        '/auth/logout',
        '/auth/me',
        '/users',
        '/users/{id}',
        '/applications',
        '/applications/{id}',
        '/applications/{id}/submit',
        '/applications/{id}/assign',
        '/applications/{id}/decision',
        '/applications/{id}/risk-review/retry',
        '/audit',
        '/health',
      ]),
    );
  });

  it('declares bearer auth and the shared error schema', async () => {
    const res = await http(app).get('/docs-json').expect(200);
    expect(res.body.components.securitySchemes.bearer).toBeDefined();
    expect(res.body.components.schemas.ErrorResponse).toBeDefined();
    const submit = res.body.paths['/applications/{id}/submit'].post;
    expect(submit.responses['409'].content['application/json'].schema.$ref).toBe(
      '#/components/schemas/ErrorResponse',
    );
  });
});
