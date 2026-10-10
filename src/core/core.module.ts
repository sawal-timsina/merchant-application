import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggerModule } from 'nestjs-pino';
import { type Env, validateEnv } from './config/env';
import {
  FIELD_ENCRYPTION_KEYRING,
  FieldEncryptionService,
} from './crypto/field-encryption.service';
import { parseKeyring } from './crypto/keyring';
import { buildDataSourceOptions } from './database/typeorm.config';

/** Cross-cutting infrastructure shared by the HTTP API and the worker process. */
@Module({
  imports: [
    // .env is loaded by Node itself (--env-file-if-exists), so every entry point
    // (api, worker, migration CLI, tests) reads configuration the same way.
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      ignoreEnvFile: true,
      validate: validateEnv,
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        pinoHttp: {
          level: config.get('LOG_LEVEL', { infer: true }),
          // Never let credentials reach the logs.
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'req.body.password',
              'req.body.refreshToken',
              'req.body.taxId',
              'res.headers["set-cookie"]',
            ],
            censor: '[REDACTED]',
          },
        },
      }),
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        buildDataSourceOptions({
          POSTGRES_HOST: config.get('POSTGRES_HOST', { infer: true }),
          POSTGRES_PORT: config.get('POSTGRES_PORT', { infer: true }),
          POSTGRES_USER: config.get('POSTGRES_USER', { infer: true }),
          POSTGRES_PASSWORD: config.get('POSTGRES_PASSWORD', { infer: true }),
          POSTGRES_DB: config.get('POSTGRES_DB', { infer: true }),
          DB_LOGGING: config.get('DB_LOGGING', { infer: true }),
        }),
    }),
  ],
  providers: [
    {
      provide: FIELD_ENCRYPTION_KEYRING,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        parseKeyring(config.get('FIELD_ENCRYPTION_KEYS', { infer: true })),
    },
    FieldEncryptionService,
  ],
  exports: [FieldEncryptionService],
})
export class CoreModule {}
