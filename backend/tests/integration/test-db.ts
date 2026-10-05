import { config } from '../../src/config/index.js';
import { createPool } from '../../src/database/connection.js';
import { runMigrations } from '../../src/database/run-migrations.js';

export const testConfig = { ...config, DB_NAME: config.DB_TEST_NAME };
if (testConfig.DB_NAME === config.DB_NAME) {
  throw new Error('DB_TEST_NAME must differ from DB_NAME; integration tests are restricted to a separate database.');
}
export const testPool = createPool(testConfig);
let migration: Promise<void> | undefined;
export function prepareTestDatabase(): Promise<void> {
  migration ??= runMigrations(testConfig);
  return migration;
}
export async function closeTestDatabase(): Promise<void> { await testPool.end(); }
