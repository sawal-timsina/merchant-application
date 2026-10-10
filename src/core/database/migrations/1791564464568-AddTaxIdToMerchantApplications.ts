import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Alters an existing table, so written to be safe against live traffic:
 * - lock_timeout makes the ALTER fail fast instead of queueing behind a long transaction
 *   (a queued ACCESS EXCLUSIVE lock blocks every later query on the table)
 * - columns and check constraint go in one ALTER TABLE: one lock, one scan
 *   (nullable ADD COLUMN without a default is metadata-only)
 */
export class AddTaxIdToMerchantApplications1791564464568 implements MigrationInterface {
  name = 'AddTaxIdToMerchantApplications1791564464568';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(
      `CREATE TYPE "tax_id_type" AS ENUM ('PAN', 'VAT', 'EIN', 'GSTIN', 'OTHER')`,
    );
    await queryRunner.query(`
      ALTER TABLE "merchant_applications"
        ADD COLUMN "tax_id_type"      "tax_id_type",
        ADD COLUMN "tax_id_encrypted" text,
        ADD COLUMN "tax_id_last4"     character varying(4),
        ADD CONSTRAINT "chk_merchant_applications_tax_id_complete" CHECK (
          ("tax_id_type" IS NULL) = ("tax_id_encrypted" IS NULL)
          AND ("tax_id_encrypted" IS NULL) = ("tax_id_last4" IS NULL)
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(`
      ALTER TABLE "merchant_applications"
        DROP CONSTRAINT "chk_merchant_applications_tax_id_complete",
        DROP COLUMN "tax_id_last4",
        DROP COLUMN "tax_id_encrypted",
        DROP COLUMN "tax_id_type"
    `);
    await queryRunner.query(`DROP TYPE "tax_id_type"`);
  }
}
