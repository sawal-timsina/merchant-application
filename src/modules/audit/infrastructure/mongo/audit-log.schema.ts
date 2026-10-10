import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';

/** Indexes are created by infra/mongo/init (as root): the app user may only insert and find. */
@Schema({ collection: 'audit_logs', versionKey: false, autoIndex: false, timestamps: false })
export class AuditLogDocument {
  /** The outbox event id: makes the projection idempotent. */
  @Prop({ type: String, required: true }) _id!: string;
  @Prop({ type: String, default: null }) actorId!: string | null;
  @Prop({ type: String, default: null }) actorRole!: string | null;
  @Prop({ type: String, required: true }) action!: string;
  @Prop({ type: String, required: true }) entityType!: string;
  @Prop({ type: String, default: null }) entityId!: string | null;
  @Prop({ type: MongooseSchema.Types.Mixed, default: {} }) metadata!: Record<string, unknown>;
  @Prop({ type: String, default: null }) requestId!: string | null;
  @Prop({ type: String, default: null }) ip!: string | null;
  @Prop({ type: Date, required: true }) createdAt!: Date;
}

export const AuditLogSchema = SchemaFactory.createForClass(AuditLogDocument);
