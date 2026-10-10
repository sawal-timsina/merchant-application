import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

/** Receipt log for inbound webhooks; the unique key makes each provider event processable once. */
@Entity('webhook_events')
@Unique(['provider', 'eventId'])
export class WebhookEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 32 })
  provider!: string;

  @Column({ type: 'varchar', length: 128 })
  eventId!: string;

  @Column({ type: 'varchar', length: 64 })
  eventType!: string;

  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  @Column({ type: 'varchar', length: 16 })
  outcome!: 'processed' | 'ignored';

  @CreateDateColumn({ type: 'timestamptz' })
  receivedAt!: Date;
}
