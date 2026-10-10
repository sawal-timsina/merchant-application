import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApplicationWorkflowService } from './application/application-workflow.service';
import { ApplicationsService } from './application/applications.service';
import { MerchantApplication } from './infrastructure/persistence/merchant-application.entity';
import { ReviewDecision } from './infrastructure/persistence/review-decision.entity';
import { ApplicationsController } from './presentation/applications.controller';

@Module({
  imports: [TypeOrmModule.forFeature([MerchantApplication, ReviewDecision])],
  controllers: [ApplicationsController],
  providers: [ApplicationsService, ApplicationWorkflowService],
  exports: [TypeOrmModule, ApplicationsService, ApplicationWorkflowService],
})
export class ApplicationsModule {}
