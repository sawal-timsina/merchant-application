import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { CoreModule } from './core/core.module';
import { OutboxWorkerModule } from './core/outbox/outbox-worker.module';
import { ApplicationsModule } from './modules/applications/applications.module';
import { AuditModule } from './modules/audit/audit.module';
import { RiskWorkerModule } from './modules/risk/risk-worker.module';

/**
 * Composition root for the background worker (no HTTP server). Hosts queue processors and
 * scheduled jobs so they scale and fail independently of the API.
 */
@Module({
  imports: [
    CoreModule,
    ApplicationsModule,
    AuditModule.forRoot(),
    OutboxWorkerModule,
    RiskWorkerModule,
    // Timers (outbox relay, reaper) only run when enabled; tests drive them explicitly.
    // Read at module definition because Nest needs to know whether to import the scheduler.
    ...(process.env.SCHEDULER_ENABLED === 'false' ? [] : [ScheduleModule.forRoot()]),
  ],
})
export class WorkerModule {}
