import { Client } from 'pg';
import { runner } from 'node-pg-migrate';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AppConfig } from '../config/env.js';

export async function runMigrations(config: AppConfig): Promise<void> {
  const client = new Client({
    host: config.DB_HOST,
    port: config.DB_PORT,
    database: config.DB_NAME,
    user: config.DB_USER,
    password: config.DB_PASSWORD,
    connectionTimeoutMillis: config.DB_CONNECTION_TIMEOUT_MS,
    application_name: 'memdev-migrations',
  });

  await client.connect();
  try {
    await runner({
      dbClient: client,
      dir: resolve(dirname(fileURLToPath(import.meta.url)), 'migrations'),
      migrationsTable: 'schema_migrations',
      direction: 'up',
      checkOrder: true,
      singleTransaction: true,
    });
  } finally {
    await client.end();
  }
}
