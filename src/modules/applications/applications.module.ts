import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { ApplicationsService } from './application/applications.service';
import { MerchantApplication } from './infrastructure/persistence/merchant-application.entity';
import { ReviewDecision } from './infrastructure/persistence/review-decision.entity';
import { ApplicationsController } from './presentation/applications.controller';

@Module({
  imports: [TypeOrmModule.forFeature([MerchantApplication, ReviewDecision]), AuditModule],
  controllers: [ApplicationsController],
  providers: [ApplicationsService],
  exports: [TypeOrmModule, ApplicationsService],
})
export class ApplicationsModule {}
