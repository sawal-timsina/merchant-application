import { applyTestEnv } from './utils/test-env';

applyTestEnv();
process.env.AUDIT_STORE = 'mongo';
// Always the test database, whatever MONGO_URI says in .env.
process.env.MONGO_URI =
  process.env.MONGO_TEST_URI ??
  `mongodb://audit_app:${process.env.MONGO_APP_PASSWORD ?? 'audit_app'}@${process.env.MONGO_HOST ?? 'localhost'}:27017/merchant_test?authSource=merchant_test`;
