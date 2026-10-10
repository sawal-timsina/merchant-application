import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';
import { bigintToNumber } from '../../../../core/database/transformers';
import { User } from '../../../identity/infrastructure/persistence/user.entity';
import {
  ApplicationStatus,
  BusinessType,
  RiskStatus,
  TaxIdType,
} from '../../domain/application.enums';

@Entity('merchant_applications')
// SALES "my applications" list, filtered by status, newest first.
@Index(['createdById', 'status', 'createdAt'])
// Reviewer work queue.
@Index(['assignedReviewerId', 'status'])
// ADMIN / REVIEWER list filtered by status.
@Index(['status', 'createdAt'])
@Check('chk_merchant_applications_volume_positive', `"expected_monthly_volume_cents" > 0`)
@Check('chk_merchant_applications_ticket_positive', `"average_ticket_cents" > 0`)
@Check(
  'chk_merchant_applications_ticket_le_volume',
  `"average_ticket_cents" <= "expected_monthly_volume_cents"`,
)
@Check('chk_merchant_applications_mcc_format', `"mcc" ~ '^[0-9]{4}$'`)
@Check('chk_merchant_applications_currency_format', `"currency" ~ '^[A-Z]{3}$'`)
// Tax id fields are all set or all empty (optional while DRAFT, required to submit).
@Check(
  'chk_merchant_applications_tax_id_complete',
  `("tax_id_type" IS NULL) = ("tax_id_encrypted" IS NULL) AND ("tax_id_encrypted" IS NULL) = ("tax_id_last4" IS NULL)`,
)
export class MerchantApplication {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // --- Business ---
  @Column({ type: 'varchar', length: 200 })
  businessName!: string;

  @Column({ type: 'varchar', length: 200 })
  legalBusinessName!: string;

  @Column({ type: 'enum', enum: Object.values(BusinessType), enumName: 'business_type' })
  businessType!: BusinessType;

  // --- Tax identification (sensitive: field-level encrypted) ---
  @Column({ type: 'enum', enum: Object.values(TaxIdType), enumName: 'tax_id_type', nullable: true })
  taxIdType!: TaxIdType | null;

  /** AES-256-GCM ciphertext from FieldEncryptionService; never returned by the API. */
  @Column({ type: 'text', nullable: true, select: false })
  taxIdEncrypted?: string | null;

  /** Last 4 characters, kept in clear so the UI can show a masked value without decrypting. */
  @Column({ type: 'varchar', length: 4, nullable: true })
  taxIdLast4!: string | null;

  // --- Owner / contact (PII: masked in logs and audit metadata) ---
  @Column({ type: 'varchar', length: 200 })
  ownerFullName!: string;

  @Column({ type: 'varchar', length: 320 })
  ownerEmail!: string;

  @Column({ type: 'varchar', length: 32 })
  ownerPhone!: string;

  // --- Requested processing ---
  /** ISO 18245 merchant category code. */
  @Column({ type: 'char', length: 4, nullable: true })
  mcc!: string | null;

  @Column({ type: 'bigint', transformer: bigintToNumber })
  expectedMonthlyVolumeCents!: number;

  @Column({ type: 'bigint', transformer: bigintToNumber })
  averageTicketCents!: number;

  /** ISO 4217 code. */
  @Column({ type: 'char', length: 3 })
  currency!: string;

  // --- Workflow ---
  @Column({
    type: 'enum',
    enum: Object.values(ApplicationStatus),
    enumName: 'application_status',
    default: ApplicationStatus.DRAFT,
  })
  status!: ApplicationStatus;

  @Column({
    type: 'enum',
    enum: Object.values(RiskStatus),
    enumName: 'risk_status',
    default: RiskStatus.NOT_STARTED,
  })
  riskStatus!: RiskStatus;

  @Column({ type: 'uuid' })
  createdById!: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'created_by_id' })
  createdBy?: Relation<User>;

  @Column({ type: 'uuid', nullable: true })
  assignedReviewerId!: string | null;

  @ManyToOne(() => User, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'assigned_reviewer_id' })
  assignedReviewer?: Relation<User> | null;

  /** Incremented on every submit; scopes risk jobs so each submission is processed exactly once. */
  @Column({ type: 'integer', default: 0 })
  submissionVersion!: number;

  /** Optimistic locking for concurrent edits / decisions. */
  @VersionColumn()
  version!: number;

  @Column({ type: 'timestamptz', nullable: true })
  submittedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  decidedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
