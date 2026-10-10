import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { MerchantApplication } from '../../../applications/infrastructure/persistence/merchant-application.entity';
import { RiskAssessmentStatus, RiskLevel } from '../../domain/risk.enums';

/**
 * One row per (application, submission). The unique constraint is the idempotency backstop:
 * a duplicated or retried job for the same submission can never create a second result.
 */
@Entity('risk_assessments')
@Unique(['applicationId', 'submissionVersion'])
@Check('chk_risk_assessments_score_range', `"score" BETWEEN 0 AND 100`)
export class RiskAssessment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  applicationId!: string;

  @ManyToOne(() => MerchantApplication, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'application_id' })
  application?: Relation<MerchantApplication>;

  @Column({ type: 'integer' })
  submissionVersion!: number;

  @Column({
    type: 'enum',
    enum: Object.values(RiskAssessmentStatus),
    enumName: 'risk_assessment_status',
    default: RiskAssessmentStatus.PENDING,
  })
  status!: RiskAssessmentStatus;

  @Column({ type: 'smallint', nullable: true })
  score!: number | null;

  @Column({ type: 'enum', enum: Object.values(RiskLevel), enumName: 'risk_level', nullable: true })
  level!: RiskLevel | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  providerReference!: string | null;

  /** Provider payload, redacted before persisting. */
  @Column({ type: 'jsonb', nullable: true })
  response!: Record<string, unknown> | null;

  @Column({ type: 'integer', default: 0 })
  attempts!: number;

  @Column({ type: 'text', nullable: true })
  lastError!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
