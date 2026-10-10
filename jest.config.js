// SWC transpiles without type-checking (fast); `pnpm typecheck` covers types.
const transform = {
  '^.+\\.ts$': [
    '@swc/jest',
    {
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
        target: 'es2023',
      },
      module: { type: 'commonjs' },
    },
  ],
};

/** @type {import('jest').Config} */
module.exports = {
  // Integration suites share one database, one outbox table and one Redis DB, and some start an
  // in-process worker that would consume other files' jobs. Running files serially keeps them
  // isolated; the whole suite still takes seconds.
  maxWorkers: 1,
  projects: [
    {
      displayName: 'unit',
      testEnvironment: 'node',
      rootDir: '.',
      testMatch: ['<rootDir>/src/**/*.spec.ts'],
      transform,
    },
    {
      displayName: 'integration',
      testEnvironment: 'node',
      rootDir: '.',
      testMatch: ['<rootDir>/test/**/*.integration-spec.ts'],
      setupFiles: ['<rootDir>/test/setup-env.ts'],
      globalSetup: '<rootDir>/test/global-setup.ts',
      testPathIgnorePatterns: ['/node_modules/', 'audit-mongo-'],
      transform,
    },
    {
      // The audit specs again, against the MongoDB audit store (AUDIT_STORE=mongo).
      displayName: 'integration-mongo',
      testEnvironment: 'node',
      rootDir: '.',
      testMatch: ['<rootDir>/test/integration/audit*.integration-spec.ts'],
      setupFiles: ['<rootDir>/test/setup-env-mongo.ts'],
      globalSetup: '<rootDir>/test/global-setup.ts',
      transform,
    },
  ],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/main.ts',
    '!src/worker.ts',
    '!src/core/database/migrations/**',
    '!src/**/*.spec.ts',
  ],
};
