import { type DynamicModule, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { Env } from '../../core/config/env';
import { AuditService } from './application/audit.service';
import { AUDIT_READER, AUDIT_WRITER } from './domain/audit-record';
import { AuditLogDocument, AuditLogSchema } from './infrastructure/mongo/audit-log.schema';
import { MongoAuditProjector } from './infrastructure/mongo/mongo-audit.projector';
import { MongoAuditReader } from './infrastructure/mongo/mongo-audit.reader';
import { OutboxAuditWriter } from './infrastructure/mongo/outbox-audit.writer';
import { AuditLog } from './infrastructure/persistence/audit-log.entity';
import { PostgresAuditReader } from './infrastructure/postgres/postgres-audit.reader';
import { PostgresAuditWriter } from './infrastructure/postgres/postgres-audit.writer';
import { AuditController } from './presentation/audit.controller';

@Module({})
export class AuditModule {
  private static module?: DynamicModule;

  /**
   * Global, imported once by each composition root (API, worker). Memoised so importing it from
   * both roots in one process (integration tests) yields a single module instance.
   *
   * The store is chosen when modules are defined, because it decides whether a Mongo connection
   * is opened at all (.env is loaded by Node before any import, so process.env is ready).
   */
  static forRoot(): DynamicModule {
    if (AuditModule.module) return AuditModule.module;
    const mongo = process.env.AUDIT_STORE === 'mongo';
    AuditModule.module = {
      module: AuditModule,
      global: true,
      imports: [
        TypeOrmModule.forFeature([AuditLog]),
        ...(mongo
          ? [
              MongooseModule.forRootAsync({
                inject: [ConfigService],
                useFactory: (config: ConfigService<Env, true>) => ({
                  uri: config.get('MONGO_URI', { infer: true }),
                  autoIndex: false,
                }),
              }),
              MongooseModule.forFeature([{ name: AuditLogDocument.name, schema: AuditLogSchema }]),
            ]
          : []),
      ],
      controllers: [AuditController],
      providers: [
        AuditService,
        ...(mongo
          ? [
              { provide: AUDIT_WRITER, useClass: OutboxAuditWriter },
              { provide: AUDIT_READER, useClass: MongoAuditReader },
              // Registers the outbox handler; only the worker's relay ever invokes it.
              MongoAuditProjector,
            ]
          : [
              { provide: AUDIT_WRITER, useClass: PostgresAuditWriter },
              { provide: AUDIT_READER, useClass: PostgresAuditReader },
            ]),
      ],
      exports: [AuditService, AUDIT_READER],
    };
    return AuditModule.module;
  }
}
