import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** Points every integration-test entry point (global setup and test workers) at the isolated test database. */
export function applyTestEnv(): void {
  const envFile = resolve(__dirname, '../../.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);

  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = process.env.TEST_LOG_LEVEL ?? 'silent';
  process.env.POSTGRES_DB = process.env.POSTGRES_TEST_DB ?? 'merchant_test';
  // Throwaway key per run; tests never depend on data encrypted by another process.
  process.env.FIELD_ENCRYPTION_KEYS ??= `test:${randomBytes(32).toString('base64')}`;
}
