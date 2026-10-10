// Entry point for the TypeORM CLI (run against compiled output: dist/database/data-source.js).
import { DataSource } from 'typeorm';
import { validateEnv } from '../config/env';
import { buildDataSourceOptions } from './typeorm.config';

export default new DataSource(buildDataSourceOptions(validateEnv(process.env)));
