import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from './infrastructure/persistence/audit-log.entity';

@Module({
  imports: [TypeOrmModule.forFeature([AuditLog])],
  exports: [TypeOrmModule],
})
export class AuditModule {}
