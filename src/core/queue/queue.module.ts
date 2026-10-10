import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';

@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        prefix: config.get('QUEUE_PREFIX', { infer: true }),
        connection: {
          host: config.get('REDIS_HOST', { infer: true }),
          port: config.get('REDIS_PORT', { infer: true }),
          password: config.get('REDIS_PASSWORD', { infer: true }),
          db: config.get('REDIS_DB', { infer: true }),
        },
      }),
    }),
  ],
})
export class QueueModule {}
