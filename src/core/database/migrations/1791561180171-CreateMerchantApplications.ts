import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateMerchantApplications1791561180171 implements MigrationInterface {
  name = 'CreateMerchantApplications1791561180171';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "business_type" AS ENUM ('SOLE_PROPRIETOR', 'PARTNERSHIP', 'LLC', 'CORPORATION', 'NON_PROFIT')`,
    );
    await queryRunner.query(
      `CREATE TYPE "application_status" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'INFO_REQUESTED', 'APPROVED', 'REJECTED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "risk_status" AS ENUM ('NOT_STARTED', 'PENDING', 'COMPLETED', 'FAILED')`,
    );
    await queryRunner.query(`
      CREATE TABLE "merchant_applications" (
        "id"                            uuid                     NOT NULL DEFAULT gen_random_uuid(),
        "business_name"                 character varying(200)   NOT NULL,
        "legal_business_name"           character varying(200)   NOT NULL,
        "business_type"                 "business_type"          NOT NULL,
        "owner_full_name"               character varying(200)   NOT NULL,
        "owner_email"                   character varying(320)   NOT NULL,
        "owner_phone"                   character varying(32)    NOT NULL,
        "mcc"                           character(4),
        "expected_monthly_volume_cents" bigint                   NOT NULL,
        "average_ticket_cents"          bigint                   NOT NULL,
        "currency"                      character(3)             NOT NULL,
        "status"                        "application_status"     NOT NULL DEFAULT 'DRAFT',
        "risk_status"                   "risk_status"            NOT NULL DEFAULT 'NOT_STARTED',
        "created_by_id"                 uuid                     NOT NULL,
        "assigned_reviewer_id"          uuid,
        "submission_version"            integer                  NOT NULL DEFAULT 0,
        "version"                       integer                  NOT NULL,
        "submitted_at"                  TIMESTAMP WITH TIME ZONE,
        "decided_at"                    TIMESTAMP WITH TIME ZONE,
        "created_at"                    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at"                    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "pk_merchant_applications" PRIMARY KEY ("id"),
        CONSTRAINT "chk_merchant_applications_volume_positive" CHECK ("expected_monthly_volume_cents" > 0),
        CONSTRAINT "chk_merchant_applications_ticket_positive" CHECK ("average_ticket_cents" > 0),
        CONSTRAINT "chk_merchant_applications_ticket_le_volume" CHECK ("average_ticket_cents" <= "expected_monthly_volume_cents"),
        CONSTRAINT "chk_merchant_applications_mcc_format" CHECK ("mcc" ~ '^[0-9]{4}$'),
        CONSTRAINT "chk_merchant_applications_currency_format" CHECK ("currency" ~ '^[A-Z]{3}$'),
        CONSTRAINT "fk_merchant_applications_created_by_id"
          FOREIGN KEY ("created_by_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT "fk_merchant_applications_assigned_reviewer_id"
          FOREIGN KEY ("assigned_reviewer_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION
      )
    `);
    // Leading columns also cover the two FK lookups.
    await queryRunner.query(
      `CREATE INDEX "idx_merchant_applications_created_by_id_status_created_at" ON "merchant_applications" ("created_by_id", "status", "created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_merchant_applications_assigned_reviewer_id_status" ON "merchant_applications" ("assigned_reviewer_id", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_merchant_applications_status_created_at" ON "merchant_applications" ("status", "created_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "merchant_applications"`);
    await queryRunner.query(`DROP TYPE "risk_status"`);
    await queryRunner.query(`DROP TYPE "application_status"`);
    await queryRunner.query(`DROP TYPE "business_type"`);
  }
}
