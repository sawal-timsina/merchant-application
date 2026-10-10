import Redis from 'ioredis';
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

/** Wipes the test Redis DB so a run never sees jobs left over from a previous one. */
async function resetTestQueues(): Promise<void> {
  const redis = new Redis({
    host: process.env.REDIS_HOST ?? 'localhost',
    port: Number(process.env.REDIS_PORT ?? 6379),
    db: Number(process.env.REDIS_DB),
    lazyConnect: true,
  });
  try {
    await redis.connect();
    if (Number(process.env.REDIS_DB) === 0) throw new Error('Refusing to flush Redis DB 0');
    await redis.flushdb();
  } finally {
    redis.disconnect();
  }
}
