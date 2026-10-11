import type { INestApplication } from '@nestjs/common';
import { createTestApp, http } from '../utils/test-app';

describe('GET /health', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports the database as up', async () => {
    await http(app).get('/api/v1/health').expect(200, { status: 'ok', database: 'up' });
  });
});
