import assert from 'node:assert/strict';
import { it } from 'node:test';
import { config } from '../../src/config/index.js';
import { pool } from '../../src/database/connection.js';
import { checkDatabase } from '../../src/modules/health/health.service.js';

it('can reach PostgreSQL with a read-only health query', { skip: config.DB_PASSWORD.length === 0 }, async () => {
  assert.equal(await checkDatabase(pool), true, 'PostgreSQL must be reachable with backend/.env settings');
});
