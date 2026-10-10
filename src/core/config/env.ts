import { z } from 'zod';
import { parseKeyring } from '../crypto/keyring';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  POSTGRES_HOST: z.string().min(1).default('localhost'),
  POSTGRES_PORT: z.coerce.number().int().positive().default(5432),
  POSTGRES_USER: z.string().min(1),
  POSTGRES_PASSWORD: z.string().min(1),
  POSTGRES_DB: z.string().min(1),
  DB_LOGGING: z.stringbool().default(false),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_TTL_SECONDS: z.coerce.number().int().positive().default(604_800),
  JWT_ISSUER: z.string().default('merchant-api'),
  JWT_AUDIENCE: z.string().default('merchant-api'),

  /** Requests per minute per IP across all routes, and for POST /auth/login. */
  THROTTLE_LIMIT: z.coerce.number().int().positive().default(300),
  LOGIN_THROTTLE_LIMIT: z.coerce.number().int().positive().default(10),

  REDIS_HOST: z.string().min(1).default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_DB: z.coerce.number().int().min(0).default(0),
  QUEUE_PREFIX: z.string().min(1).default('merchant'),
  RISK_JOB_ATTEMPTS: z.coerce.number().int().min(1).default(5),
  RISK_JOB_BACKOFF_MS: z.coerce.number().int().min(1).default(2000),
  /** Worker timers (outbox relay, reaper). Tests disable them and drive the jobs explicitly. */
  SCHEDULER_ENABLED: z.stringbool().default(true),

  /** Simulated KYB provider: mean latency and probability of a transient failure per call. */
  KYB_LATENCY_MS: z.coerce.number().int().min(0).default(300),
  KYB_FAILURE_RATE: z.coerce.number().min(0).max(1).default(0.1),

  /** Only read by `pnpm db:seed`; never needed at runtime. */
  SEED_USER_PASSWORD: z.string().min(12).optional(),

  /** `keyId:base64(32 bytes)` pairs, active first. Generate with: openssl rand -base64 32 */
  FIELD_ENCRYPTION_KEYS: z.string().superRefine((value, ctx) => {
    try {
      parseKeyring(value);
    } catch (error) {
      ctx.addIssue({ code: 'custom', message: (error as Error).message });
    }
  }),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
