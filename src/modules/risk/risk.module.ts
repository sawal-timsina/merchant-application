import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { Env } from '../../core/config/env';
import { WebhookEvent } from '../../core/webhooks/webhook-event.entity';
import { AuditModule } from '../audit/audit.module';
import { KybWebhookService } from './application/kyb-webhook.service';
import { RiskAssessmentCompleter } from './application/risk-assessment-completer';
import { RiskAssessment } from './infrastructure/persistence/risk-assessment.entity';
import { RISK_REVIEW_DLQ, RISK_REVIEW_QUEUE } from './infrastructure/queue/risk-queue';
import { KybSignatureGuard } from './presentation/kyb-signature.guard';
import { KybWebhookController } from './presentation/kyb-webhook.controller';

/**
 * API-side risk module: registers the queues (for producers and inspection) and receives KYB
 * callbacks. Job processing lives in RiskWorkerModule.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([RiskAssessment, WebhookEvent]),
    AuditModule,
    BullModule.registerQueueAsync({
      name: RISK_REVIEW_QUEUE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        defaultJobOptions: {
          attempts: config.get('RISK_JOB_ATTEMPTS', { infer: true }),
          backoff: {
            type: 'exponential',
            delay: config.get('RISK_JOB_BACKOFF_MS', { infer: true }),
          },
          removeOnComplete: { age: 24 * 3600, count: 10_000 },
          removeOnFail: false, // keep failed jobs for inspection and retry
        },
      }),
    }),
    BullModule.registerQueue({ name: RISK_REVIEW_DLQ }),
  ],
  controllers: [KybWebhookController],
  providers: [RiskAssessmentCompleter, KybWebhookService, KybSignatureGuard],
  exports: [TypeOrmModule, BullModule, RiskAssessmentCompleter],
})
export class RiskModule {}
