import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateRefreshTokens1791564464566 implements MigrationInterface {
  name = 'CreateRefreshTokens1791564464566';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "refresh_tokens" (
        "id"             uuid                     NOT NULL DEFAULT gen_random_uuid(),
        "user_id"        uuid                     NOT NULL,
        "family_id"      uuid                     NOT NULL,
        "token_hash"     character(64)            NOT NULL,
        "expires_at"     TIMESTAMP WITH TIME ZONE NOT NULL,
        "revoked_at"     TIMESTAMP WITH TIME ZONE,
        "replaced_by_id" uuid,
        "created_at"     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "pk_refresh_tokens" PRIMARY KEY ("id"),
        CONSTRAINT "uq_refresh_tokens_token_hash" UNIQUE ("token_hash"),
        CONSTRAINT "fk_refresh_tokens_user_id"
          FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_refresh_tokens_user_id" ON "refresh_tokens" ("user_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_refresh_tokens_family_id" ON "refresh_tokens" ("family_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "refresh_tokens"`);
  }
}
