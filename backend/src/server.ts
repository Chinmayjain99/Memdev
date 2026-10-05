import { createApp } from './app.js';
import { config } from './config/index.js';
import { pool } from './database/connection.js';
import { logger } from './utils/logger.js';

const server = createApp(pool).listen(config.PORT, () => {
  logger.info({ port: config.PORT }, 'MemDev API listening');
});

function shutdown(signal: string): void {
  logger.info({ signal }, 'Shutting down');
  server.close((error) => {
    if (error) logger.error({ err: error }, 'HTTP server shutdown failed');
    void pool.end().finally(() => process.exit(error ? 1 : 0));
  });
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
