import { Module } from '@nestjs/common';
import { CoreModule } from './core/core.module';
import { HealthController } from './core/health/health.controller';
import { ApplicationsModule } from './modules/applications/applications.module';
import { AuditModule } from './modules/audit/audit.module';
import { IdentityModule } from './modules/identity/identity.module';
import { RiskModule } from './modules/risk/risk.module';

/** Composition root for the HTTP API. Enqueues background work; never processes it. */
@Module({
  imports: [CoreModule, IdentityModule, ApplicationsModule, RiskModule, AuditModule],
  controllers: [HealthController],
})
export class AppModule {}
