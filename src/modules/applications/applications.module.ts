import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MerchantApplication } from './infrastructure/persistence/merchant-application.entity';
import { ReviewDecision } from './infrastructure/persistence/review-decision.entity';

@Module({
  imports: [TypeOrmModule.forFeature([MerchantApplication, ReviewDecision])],
  exports: [TypeOrmModule],
})
export class ApplicationsModule {}
