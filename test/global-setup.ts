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
}
