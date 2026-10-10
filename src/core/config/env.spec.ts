import { validateEnv } from './env';

const required = {
  FIELD_ENCRYPTION_KEYS: `v1:${Buffer.alloc(32, 1).toString('base64')}`,
  POSTGRES_USER: 'u',
  POSTGRES_PASSWORD: 'p',
  POSTGRES_DB: 'd',
};

describe('validateEnv', () => {
  it('applies defaults', () => {
    expect(validateEnv(required)).toMatchObject({
      NODE_ENV: 'development',
      PORT: 3000,
      POSTGRES_HOST: 'localhost',
      POSTGRES_PORT: 5432,
      DB_LOGGING: false,
    });
  });

  it('coerces numbers and booleans from strings', () => {
    const env = validateEnv({ ...required, PORT: '8080', DB_LOGGING: 'true' });
    expect(env.PORT).toBe(8080);
    expect(env.DB_LOGGING).toBe(true);
  });

  it('rejects invalid values', () => {
    expect(() => validateEnv({ ...required, NODE_ENV: 'staging' })).toThrow(/Invalid environment/);
  });

  it('rejects a malformed encryption keyring without echoing key material', () => {
    expect(() => validateEnv({ ...required, FIELD_ENCRYPTION_KEYS: 'v1:dG9vLXNob3J0' })).toThrow(
      /must be 32 bytes/,
    );
  });

  it('requires database credentials', () => {
    expect(() => validateEnv({})).toThrow(/POSTGRES_PASSWORD/);
  });
});
