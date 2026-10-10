import { Queue } from 'bullmq';
import { applyTestEnv } from './utils/test-env';
import { createTestDataSource } from './utils/test-data-source';

/**
 * Rebuilds the test database from scratch with the real migrations (never synchronize),
 * so every integration test run also proves the migrations apply cleanly.
 */
export default async function globalSetup(): Promise<void> {
  applyTestEnv();
  const dataSource = await createTestDataSource();
  try {
    if (!dataSource.options.database?.toString().endsWith('_test')) {
      throw new Error(`Refusing to reset non-test database "${dataSource.options.database}"`);
    }
    await dataSource.query('DROP SCHEMA public CASCADE');
    await dataSource.query('CREATE SCHEMA public');
    await dataSource.runMigrations({ transaction: 'each' });
  } finally {
    await dataSource.destroy();
  }
  await resetTestQueues();
}

/** Empties the test-prefixed queues in the test Redis DB so runs never see each other's jobs. */
async function resetTestQueues(): Promise<void> {
  const connection = {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: Number(process.env.REDIS_PORT ?? 6379),
    db: Number(process.env.REDIS_DB),
  };
  for (const name of ['risk-review', 'risk-review-dlq']) {
    const queue = new Queue(name, { connection, prefix: process.env.QUEUE_PREFIX });
    await queue.obliterate({ force: true });
    await queue.close();
  }
}
