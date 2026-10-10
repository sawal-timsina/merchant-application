import { Module } from '@nestjs/common';
import { CoreModule } from './core/core.module';
import { ApplicationsModule } from './modules/applications/applications.module';
import { AuditModule } from './modules/audit/audit.module';
import { RiskModule } from './modules/risk/risk.module';

/**
 * Composition root for the background worker (no HTTP server). Hosts queue processors and
 * scheduled jobs so they scale and fail independently of the API.
 */
@Module({
  imports: [CoreModule, ApplicationsModule, RiskModule, AuditModule],
})
export class WorkerModule {}
