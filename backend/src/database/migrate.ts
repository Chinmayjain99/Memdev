import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { runMigrations } from './run-migrations.js';

try {
  await runMigrations(config);
  logger.info({ database: config.DB_NAME }, 'Database migrations are up to date');
} catch (error) {
  logger.error(
    { errorName: error instanceof Error ? error.name : 'UnknownError' },
    'Database migration failed; detailed error omitted',
  );
  process.exitCode = 1;
}
