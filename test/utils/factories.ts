import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import argon2 from 'argon2';
import { DataSource } from 'typeorm';
import { UserRole } from '../../src/modules/identity/domain/user-role';
import { User } from '../../src/modules/identity/infrastructure/persistence/user.entity';

// Hashing is slow by design; reuse one hash for every test user.
const TEST_PASSWORD = 'test-password-not-a-secret';
let testPasswordHash: Promise<string> | undefined;

export async function createUser(
  app: INestApplication,
  overrides: { role?: UserRole; isActive?: boolean } = {},
): Promise<{ id: string; email: string; password: string; role: UserRole }> {
  testPasswordHash ??= argon2.hash(TEST_PASSWORD, { type: argon2.argon2id });
  const role = overrides.role ?? UserRole.SALES;
  const email = `${role.toLowerCase()}-${randomUUID()}@example.com`;
  const user = await app
    .get(DataSource)
    .getRepository(User)
    .save({
      email,
      fullName: `Test ${role}`,
      role,
      isActive: overrides.isActive ?? true,
      passwordHash: await testPasswordHash,
    });
  return { id: user.id, email, password: TEST_PASSWORD, role };
}
