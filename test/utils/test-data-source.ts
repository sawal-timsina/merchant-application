import { DataSource } from 'typeorm';
import { validateEnv } from '../../src/core/config/env';
import { buildDataSourceOptions } from '../../src/core/database/typeorm.config';

export async function createTestDataSource(): Promise<DataSource> {
  const dataSource = new DataSource({
    ...buildDataSourceOptions(validateEnv(process.env)),
    logging: false,
  });
  return dataSource.initialize();
}
