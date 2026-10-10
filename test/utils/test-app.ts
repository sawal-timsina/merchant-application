import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { WorkerModule } from '../../src/worker.module';

/**
 * Boots the real AppModule with the production HTTP pipeline (validation, Swagger, filters),
 * against the test database. Supertest drives it in-process, no port is opened.
 */
export async function createTestApp(
  options: { worker?: boolean; overrides?: Array<{ token: unknown; value: unknown }> } = {},
): Promise<INestApplication> {
  let builder = Test.createTestingModule({
    // worker: also run the worker's modules in-process (outbox relay, processors, reaper).
    imports: options.worker ? [AppModule, WorkerModule] : [AppModule],
  });
  for (const { token, value } of options.overrides ?? []) {
    builder = builder.overrideProvider(token as never).useValue(value);
  }
  const moduleRef = await builder.compile();
  const app = configureApp(moduleRef.createNestApplication({ logger: false, rawBody: true }));
  await app.init();
  return app;
}

export function http(app: INestApplication) {
  return request(app.getHttpServer());
}
