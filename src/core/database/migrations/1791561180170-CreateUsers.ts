import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUsers1791561180170 implements MigrationInterface {
  name = 'CreateUsers1791561180170';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Case-insensitive email uniqueness.
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS citext`);
    // Shared with audit_logs.actor_role.
    await queryRunner.query(`CREATE TYPE "user_role" AS ENUM ('ADMIN', 'REVIEWER', 'SALES')`);
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id"            uuid                     NOT NULL DEFAULT gen_random_uuid(),
        "email"         citext                   NOT NULL,
        "password_hash" text                     NOT NULL,
        "full_name"     character varying(200)   NOT NULL,
        "role"          "user_role"              NOT NULL,
        "is_active"     boolean                  NOT NULL DEFAULT true,
        "created_at"    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at"    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "pk_users" PRIMARY KEY ("id"),
        CONSTRAINT "uq_users_email" UNIQUE ("email")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "users"`);
    await queryRunner.query(`DROP TYPE "user_role"`);
    // citext is left installed: other objects in the database may depend on it.
  }
}
