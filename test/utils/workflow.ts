import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';

const toColumn = (key: string) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/** Arrange-only shortcut: puts an application into a state without running the workflow. */
export async function setStatus(
  app: INestApplication,
  id: string,
  status: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const columns: Record<string, unknown> = { status, ...extra };
  const sets = Object.keys(columns).map((k, i) => `"${toColumn(k)}" = $${i + 2}`);
  await app
    .get(DataSource)
    .query(`UPDATE merchant_applications SET ${sets.join(', ')} WHERE id = $1`, [
      id,
      ...Object.values(columns),
    ]);
}
