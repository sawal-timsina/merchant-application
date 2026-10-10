import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Transactional outbox. Events are inserted in the same transaction as the state change that
 * caused them, then relayed to the queue by the worker. This removes the gap where a crash
 * between "commit" and "enqueue" would silently lose the job.
 */
@Entity('outbox_events')
// Relay polling: unprocessed events that are due, oldest first.
@Index(['availableAt'], { where: '"processed_at" IS NULL' })
export class OutboxEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64 })
  aggregateType!: string;

  @Column({ type: 'uuid' })
  aggregateId!: string;

  @Column({ type: 'varchar', length: 100 })
  eventType!: string;

  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  /** Request id that caused the event, carried into job logs and audit rows. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  correlationId!: string | null;

  /** Relay backoff: the event is not picked up before this time. */
  @Column({ type: 'timestamptz', default: () => 'now()' })
  availableAt!: Date;

  @Column({ type: 'integer', default: 0 })
  attempts!: number;

  @Column({ type: 'text', nullable: true })
  lastError!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  processedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
