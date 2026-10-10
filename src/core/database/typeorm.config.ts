import type { DataSourceOptions } from 'typeorm';
import type { Env } from '../config/env';
import { entities } from './entities';
import { migrations } from './migrations';
import { SnakeNamingStrategy } from './snake-naming.strategy';

/** Single source of truth for the Nest TypeOrmModule, the migration CLI, and tests. */
export type DatabaseEnv = Pick<
  Env,
  | 'POSTGRES_HOST'
  | 'POSTGRES_PORT'
  | 'POSTGRES_USER'
  | 'POSTGRES_PASSWORD'
  | 'POSTGRES_DB'
  | 'DB_LOGGING'
>;

export function buildDataSourceOptions(env: DatabaseEnv): DataSourceOptions {
  return {
    type: 'postgres',
    host: env.POSTGRES_HOST,
    port: env.POSTGRES_PORT,
    username: env.POSTGRES_USER,
    password: env.POSTGRES_PASSWORD,
    database: env.POSTGRES_DB,
    entities,
    migrations,
    namingStrategy: new SnakeNamingStrategy(),
    // gen_random_uuid() is built into Postgres 13+; avoids needing the uuid-ossp extension.
    uuidExtension: 'pgcrypto',
    // Schema changes only ever happen through reviewed migrations.
    synchronize: false,
    migrationsRun: false,
    migrationsTransactionMode: 'each',
    logging: env.DB_LOGGING ? ['query', 'error'] : ['error'],
  };
}
