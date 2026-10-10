import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateReviewDecisions1791561180172 implements MigrationInterface {
  name = 'CreateReviewDecisions1791561180172';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "review_decision" AS ENUM ('APPROVE', 'REJECT', 'REQUEST_INFO')`,
    );
    await queryRunner.query(`
      CREATE TABLE "review_decisions" (
        "id"             uuid                     NOT NULL DEFAULT gen_random_uuid(),
        "application_id" uuid                     NOT NULL,
        "reviewer_id"    uuid                     NOT NULL,
        "decision"       "review_decision"        NOT NULL,
        "reason"         text,
        "created_at"     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "pk_review_decisions" PRIMARY KEY ("id"),
        CONSTRAINT "fk_review_decisions_application_id"
          FOREIGN KEY ("application_id") REFERENCES "merchant_applications" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT "fk_review_decisions_reviewer_id"
          FOREIGN KEY ("reviewer_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_review_decisions_application_id_created_at" ON "review_decisions" ("application_id", "created_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "review_decisions"`);
    await queryRunner.query(`DROP TYPE "review_decision"`);
  }
}
