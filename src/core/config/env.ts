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
