import { type DynamicModule, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditService } from './application/audit.service';
import { AUDIT_READER, AUDIT_WRITER } from './domain/audit-record';
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
   */
  static forRoot(): DynamicModule {
    AuditModule.module ??= {
      module: AuditModule,
      global: true,
      imports: [TypeOrmModule.forFeature([AuditLog])],
      controllers: [AuditController],
      providers: [
        AuditService,
        { provide: AUDIT_WRITER, useClass: PostgresAuditWriter },
        { provide: AUDIT_READER, useClass: PostgresAuditReader },
      ],
      exports: [AuditService, AUDIT_READER],
    };
    return AuditModule.module;
  }
}
