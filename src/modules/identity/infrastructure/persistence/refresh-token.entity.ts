import { Exclude } from 'class-transformer';
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
import { User } from './user.entity';

/**
 * Rotating refresh tokens. Only a SHA-256 hash is stored; the raw token exists only on the client.
 * Every rotation stays in the same `family`: presenting an already-rotated token means it was
 * stolen, so the whole family is revoked.
 */
@Entity('refresh_tokens')
@Index(['userId'])
@Index(['familyId'])
export class RefreshToken {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: Relation<User>;

  @Column({ type: 'uuid' })
  familyId!: string;

  /** Hex SHA-256 of the token. Lookups are by hash, so no plaintext token is ever persisted. */
  @Exclude()
  @Column({ type: 'char', length: 64, unique: true })
  tokenHash!: string;

  @Column({ type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  /** Set when rotated; a used token with this set is a replay. */
  @Column({ type: 'uuid', nullable: true })
  replacedById!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
