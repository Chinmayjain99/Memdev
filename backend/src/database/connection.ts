import { Pool, type QueryResult, type QueryResultRow } from 'pg';
import type { AppConfig } from '../config/env.js';
import { config } from '../config/index.js';

export function createPool(config: AppConfig): Pool {
  return new Pool({
    host: config.DB_HOST,
    port: config.DB_PORT,
    database: config.DB_NAME,
    user: config.DB_USER,
    password: config.DB_PASSWORD,
    connectionTimeoutMillis: config.DB_CONNECTION_TIMEOUT_MS,
    statement_timeout: 2000,
    application_name: 'memdev-backend',
  });
}

export const pool = createPool(config);

export function query<Row extends QueryResultRow>(
  text: string,
  values?: readonly unknown[],
): Promise<QueryResult<Row>> {
  return pool.query<Row>(text, values ? [...values] : undefined);
}
