import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
} from 'typeorm';
import { User } from '../../../identity/infrastructure/persistence/user.entity';
import { ReviewDecisionType } from '../../domain/application.enums';
import { MerchantApplication } from './merchant-application.entity';

/** Immutable history of reviewer decisions; the application row holds only the current status. */
@Entity('review_decisions')
@Index(['applicationId', 'createdAt'])
export class ReviewDecision {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  applicationId!: string;

  @ManyToOne(() => MerchantApplication, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'application_id' })
  application?: Relation<MerchantApplication>;

  @Column({ type: 'uuid' })
  reviewerId!: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'reviewer_id' })
  reviewer?: Relation<User>;

  @Column({ type: 'enum', enum: Object.values(ReviewDecisionType), enumName: 'review_decision' })
  decision!: ReviewDecisionType;

  @Column({ type: 'text', nullable: true })
  reason!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
