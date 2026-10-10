// Dev-only: creates one user per role with fictitious identities. Run: pnpm db:seed
import argon2 from 'argon2';
import { DataSource } from 'typeorm';
import { UserRole } from '../../modules/identity/domain/user-role';
import { User } from '../../modules/identity/infrastructure/persistence/user.entity';
import { validateEnv } from '../config/env';
import { buildDataSourceOptions } from './typeorm.config';

async function seed(): Promise<void> {
  const env = validateEnv(process.env);
  if (env.NODE_ENV === 'production') throw new Error('Refusing to seed a production database');
  if (!env.SEED_USER_PASSWORD) throw new Error('Set SEED_USER_PASSWORD (12+ chars) to seed users');

  const dataSource = await new DataSource(buildDataSourceOptions(env)).initialize();
  try {
    const passwordHash = await argon2.hash(env.SEED_USER_PASSWORD, { type: argon2.argon2id });
    const users = [
      { email: 'admin@example.com', fullName: 'Avery Admin', role: UserRole.ADMIN },
      { email: 'reviewer@example.com', fullName: 'Riley Reviewer', role: UserRole.REVIEWER },
      { email: 'reviewer2@example.com', fullName: 'Robin Reviewer', role: UserRole.REVIEWER },
      { email: 'sales@example.com', fullName: 'Sam Sales', role: UserRole.SALES },
      { email: 'sales2@example.com', fullName: 'Sky Sales', role: UserRole.SALES },
    ];
    await dataSource
      .createQueryBuilder()
      .insert()
      .into(User)
      .values(users.map((u) => ({ ...u, passwordHash })))
      .orIgnore()
      .execute();
    process.stdout.write(`Seeded ${users.length} users (existing emails skipped)\n`);
  } finally {
    await dataSource.destroy();
  }
}

void seed();
