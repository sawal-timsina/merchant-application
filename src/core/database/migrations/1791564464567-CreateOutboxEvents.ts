import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOutboxEvents1791564464567 implements MigrationInterface {
  name = 'CreateOutboxEvents1791564464567';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "outbox_events" (
        "id"             uuid                     NOT NULL DEFAULT gen_random_uuid(),
        "aggregate_type" character varying(64)    NOT NULL,
        "aggregate_id"   uuid                     NOT NULL,
        "event_type"     character varying(100)   NOT NULL,
        "payload"        jsonb                    NOT NULL,
        "correlation_id" character varying(64),
        "available_at"   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "attempts"       integer                  NOT NULL DEFAULT 0,
        "last_error"     text,
        "processed_at"   TIMESTAMP WITH TIME ZONE,
        "created_at"     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "pk_outbox_events" PRIMARY KEY ("id")
      )
    `);
    // Partial: processed events (the vast majority over time) stay out of the relay's index.
    await queryRunner.query(`
      CREATE INDEX "idx_outbox_events_available_at" ON "outbox_events" ("available_at")
      WHERE "processed_at" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "outbox_events"`);
  }
}
