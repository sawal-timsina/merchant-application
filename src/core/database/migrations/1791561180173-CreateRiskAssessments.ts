import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateRiskAssessments1791561180173 implements MigrationInterface {
  name = 'CreateRiskAssessments1791561180173';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "risk_assessment_status" AS ENUM ('PENDING', 'COMPLETED', 'FAILED')`,
    );
    await queryRunner.query(`CREATE TYPE "risk_level" AS ENUM ('LOW', 'MEDIUM', 'HIGH')`);
    await queryRunner.query(`
      CREATE TABLE "risk_assessments" (
        "id"                 uuid                     NOT NULL DEFAULT gen_random_uuid(),
        "application_id"     uuid                     NOT NULL,
        "submission_version" integer                  NOT NULL,
        "status"             "risk_assessment_status" NOT NULL DEFAULT 'PENDING',
        "score"              smallint,
        "level"              "risk_level",
        "provider_reference" character varying(100),
        "response"           jsonb,
        "attempts"           integer                  NOT NULL DEFAULT 0,
        "last_error"         text,
        "completed_at"       TIMESTAMP WITH TIME ZONE,
        "created_at"         TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at"         TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "pk_risk_assessments" PRIMARY KEY ("id"),
        -- Idempotency backstop: one result per application submission.
        CONSTRAINT "uq_risk_assessments_application_id_submission_version" UNIQUE ("application_id", "submission_version"),
        CONSTRAINT "chk_risk_assessments_score_range" CHECK ("score" BETWEEN 0 AND 100),
        CONSTRAINT "fk_risk_assessments_application_id"
          FOREIGN KEY ("application_id") REFERENCES "merchant_applications" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "risk_assessments"`);
    await queryRunner.query(`DROP TYPE "risk_level"`);
    await queryRunner.query(`DROP TYPE "risk_assessment_status"`);
  }
}
