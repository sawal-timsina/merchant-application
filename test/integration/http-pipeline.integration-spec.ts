import type { INestApplication } from '@nestjs/common';
import { createTestApp, http } from '../utils/test-app';

describe('HTTP pipeline', () => {
  let app: INestApplication;
  beforeAll(async () => (app = await createTestApp()));
  afterAll(async () => app.close());

  it('returns the standard error body with a request id for unknown routes', async () => {
    const res = await http(app).get('/api/v1/does-not-exist').expect(404);
    expect(res.headers['x-request-id']).toEqual(expect.any(String));
    expect(res.body).toEqual({
      statusCode: 404,
      error: 'Not Found',
      message: expect.any(String),
      requestId: res.headers['x-request-id'],
    });
  });

  it('propagates a well-formed incoming x-request-id', async () => {
    const res = await http(app).get('/api/v1/health').set('x-request-id', 'trace-abc-12345');
    expect(res.headers['x-request-id']).toBe('trace-abc-12345');
  });

  it('replaces a malformed x-request-id', async () => {
    const res = await http(app).get('/api/v1/health').set('x-request-id', 'bad id<script>');
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});
