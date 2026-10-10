import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { Env } from '../../core/config/env';
import { RiskAssessment } from './infrastructure/persistence/risk-assessment.entity';
import { RISK_REVIEW_DLQ, RISK_REVIEW_QUEUE } from './infrastructure/queue/risk-queue';

/** API-side: registers the queues (for producers and inspection). Processing lives in RiskWorkerModule. */
@Module({
  imports: [
    TypeOrmModule.forFeature([RiskAssessment]),
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
  exports: [TypeOrmModule, BullModule],
})
export class RiskModule {}
