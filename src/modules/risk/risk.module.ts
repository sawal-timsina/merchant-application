import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RiskAssessment } from './infrastructure/persistence/risk-assessment.entity';

@Module({
  imports: [TypeOrmModule.forFeature([RiskAssessment])],
  exports: [TypeOrmModule],
})
export class RiskModule {}
