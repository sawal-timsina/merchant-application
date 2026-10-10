import type { MigrationInterface, QueryRunner } from 'typeorm';

/** The append-only triggers are hand-written: migration:generate cannot express triggers. */
export class CreateAuditLogs1791561180174 implements MigrationInterface {
  name = 'CreateAuditLogs1791561180174';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "audit_logs" (
        "id"          bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
        "actor_id"    uuid,
        "actor_role"  "user_role",
        "action"      character varying(64)    NOT NULL,
        "entity_type" character varying(64)    NOT NULL,
        "entity_id"   character varying(64),
        "metadata"    jsonb                    NOT NULL DEFAULT '{}'::jsonb,
        "request_id"  character varying(64),
        "ip"          inet,
        "created_at"  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "pk_audit_logs" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_audit_logs_entity_type_entity_id_created_at" ON "audit_logs" ("entity_type", "entity_id", "created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_audit_logs_actor_id_created_at" ON "audit_logs" ("actor_id", "created_at")`,
    );
    await queryRunner.query(`
      CREATE FUNCTION "audit_logs_prevent_mutation"() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'audit_logs is append-only (% blocked)', TG_OP
          USING ERRCODE = 'insufficient_privilege';
      END;
      $$
    `);
    await queryRunner.query(`
      CREATE TRIGGER "trg_audit_logs_append_only"
      BEFORE UPDATE OR DELETE ON "audit_logs"
      FOR EACH ROW EXECUTE FUNCTION "audit_logs_prevent_mutation"()
    `);
    // Row triggers don't fire on TRUNCATE.
    await queryRunner.query(`
      CREATE TRIGGER "trg_audit_logs_no_truncate"
      BEFORE TRUNCATE ON "audit_logs"
      FOR EACH STATEMENT EXECUTE FUNCTION "audit_logs_prevent_mutation"()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "audit_logs"`);
    await queryRunner.query(`DROP FUNCTION "audit_logs_prevent_mutation"()`);
  }
}
