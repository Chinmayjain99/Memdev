import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { parseConfig } from '../../src/config/env.js';
import { pool } from '../../src/database/connection.js';

const app = createApp(pool);
after(async () => pool.end());

describe('HTTP foundation', () => {
  it('reports liveness without requiring PostgreSQL', async () => {
    const response = await request(app).get('/health');
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { status: 'ok' });
    assert.ok(response.headers['x-content-type-options']);
  });

  it('returns a consistent 404 response', async () => {
    const response = await request(app).get('/missing');
    assert.equal(response.status, 404);
    assert.deepEqual(response.body, { error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });
});

describe('configuration', () => {
  it('applies defaults and parses valid settings', () => {
    const config = parseConfig({});
    assert.equal(config.PORT, 4000);
    assert.equal(config.DB_PORT, 5432);
    assert.equal(config.DB_NAME, 'memdev');
  });

  it('rejects invalid ports and missing production credentials', () => {
    assert.throws(() => parseConfig({ PORT: '70000' }));
    assert.throws(() => parseConfig({ NODE_ENV: 'production' }));
  });
});
