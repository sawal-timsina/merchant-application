import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { UserRole } from '../../../identity/domain/user-role';

/**
 * Append-only (UPDATE/DELETE are blocked by a trigger, see the initial migration).
 * actor_id deliberately has no FK: audit history must outlive the rows it describes.
 */
@Entity('audit_logs')
@Index(['entityType', 'entityId', 'createdAt'])
@Index(['actorId', 'createdAt'])
export class AuditLog {
  // bigint comes back from pg as a string; ids are opaque so we keep it that way.
  @PrimaryGeneratedColumn('identity', { type: 'bigint', generatedIdentity: 'ALWAYS' })
  id!: string;

  /** NULL for system actors (e.g. the risk worker). */
  @Column({ type: 'uuid', nullable: true })
  actorId!: string | null;

  @Column({ type: 'enum', enum: Object.values(UserRole), enumName: 'user_role', nullable: true })
  actorRole!: UserRole | null;

  @Column({ type: 'varchar', length: 64 })
  action!: string;

  @Column({ type: 'varchar', length: 64 })
  entityType!: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  entityId!: string | null;

  /** Redacted before insert; never contains secrets or raw PII. */
  @Column({ type: 'jsonb', default: {} })
  metadata!: Record<string, unknown>;

  @Column({ type: 'varchar', length: 64, nullable: true })
  requestId!: string | null;

  @Column({ type: 'inet', nullable: true })
  ip!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
