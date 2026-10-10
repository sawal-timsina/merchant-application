import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Postgres cannot remove a value from an enum, so down() leaves AWAITING_CALLBACK in place
 * (unused values are harmless); everything else is reverted.
 */
export class AddKybCallbackSupport1791700000000 implements MigrationInterface {
  name = 'AddKybCallbackSupport1791700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "risk_assessment_status" ADD VALUE IF NOT EXISTS 'AWAITING_CALLBACK'`,
    );
    await queryRunner.query(`
      CREATE TABLE "webhook_events" (
        "id"          uuid                     NOT NULL DEFAULT gen_random_uuid(),
        "provider"    character varying(32)    NOT NULL,
        "event_id"    character varying(128)   NOT NULL,
        "event_type"  character varying(64)    NOT NULL,
        "payload"     jsonb                    NOT NULL,
        "outcome"     character varying(16)    NOT NULL,
        "received_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "pk_webhook_events" PRIMARY KEY ("id"),
        -- Idempotency: a provider event is recorded (and therefore processed) at most once.
        CONSTRAINT "uq_webhook_events_provider_event_id" UNIQUE ("provider", "event_id")
      )
    `);
    // Callback lookup: find the assessment a provider reference belongs to.
    await queryRunner.query(
      `CREATE INDEX "idx_risk_assessments_provider_reference" ON "risk_assessments" ("provider_reference")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_risk_assessments_provider_reference"`);
    await queryRunner.query(`DROP TABLE "webhook_events"`);
  }
}
