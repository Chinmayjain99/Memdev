import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import type { PoolClient } from 'pg';
import { withTransaction } from '../../src/database/transaction.js';
import { prepareTestDatabase, testPool } from './test-db.js';

function firstRow<Row>(rows: readonly Row[]): Row {
  const row = rows[0];
  assert.ok(row);
  return row;
}

function postgresErrorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
  return undefined;
}

async function withRollback<Result>(operation: (client: PoolClient) => Promise<Result>): Promise<Result> {
  const client = await testPool.connect();
  await client.query('BEGIN');
  try {
    return await operation(client);
  } finally {
    try {
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  }
}

before(prepareTestDatabase);

describe('database schema', () => {
  it('applies the tracked migration repeatably', async () => {
    await prepareTestDatabase();
    const result = await testPool.query<{ count: string }>('SELECT count(*)::text AS count FROM schema_migrations');
    assert.equal(result.rows[0]?.count, '3');
  });

  it('creates the expected tables, constraints, foreign keys, indexes, and extension', async () => {
    const authColumns = await testPool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema()
       AND table_name='users' AND column_name='password_hash'`,
    );
    assert.equal(authColumns.rowCount, 1);
    const rotationColumns = await testPool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema()
       AND table_name='refresh_sessions' AND column_name=ANY($1::text[])`,
      [['family_id', 'replaced_by_session_id']],
    );
    assert.deepEqual(rotationColumns.rows.map((row) => row.column_name).sort(), ['family_id', 'replaced_by_session_id']);
    const tables = await testPool.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables
       WHERE schemaname = current_schema()
         AND tablename = ANY($1::text[])`,
      [['users', 'oauth_accounts', 'refresh_sessions', 'memories', 'memory_changes']],
    );
    assert.deepEqual(tables.rows.map(({ tablename }) => tablename).sort(),
      ['memories', 'memory_changes', 'oauth_accounts', 'refresh_sessions', 'users']);

    const constraints = await testPool.query<{ conname: string }>(
      `SELECT conname FROM pg_constraint
       WHERE conname = ANY($1::text[])`,
      [[
        'memories_capture_content', 'memories_capture_type', 'memories_deletion_consistent',
        'memories_revisit_count_nonnegative', 'memories_version_positive',
        'memory_changes_memory_owner_fk', 'memory_changes_operation',
        'oauth_accounts_user_id_fkey', 'refresh_sessions_user_id_fkey',
        'memories_user_id_fkey', 'memory_changes_user_id_fkey',
      ]],
    );
    assert.equal(constraints.rowCount, 11);

    const indexes = await testPool.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
       WHERE schemaname = current_schema()
         AND indexname = ANY($1::text[])`,
      [[
        'users_email_lower_unique_idx', 'oauth_accounts_user_id_idx',
        'refresh_sessions_expires_at_idx', 'refresh_sessions_active_expiry_idx', 'memories_user_created_idx',
        'memories_user_updated_idx', 'memories_search_vector_idx',
        'memories_title_trigram_idx', 'memory_changes_user_cursor_idx',
      ]],
    );
    assert.equal(indexes.rowCount, 9);

    const extension = await testPool.query<{ installed: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') AS installed`,
    );
    assert.equal(extension.rows[0]?.installed, true);
  });

  it('accepts representative user, provider, hashed session, memory, and change records', async () => {
    await withRollback(async (client) => {
      const user = await client.query<{ id: string }>(
        `INSERT INTO users (email, display_name) VALUES ('person@example.test', 'MemDev User') RETURNING id`,
      );
      const userId = firstRow(user.rows).id;
      const memory = await client.query<{ id: string }>(
        `INSERT INTO memories (user_id, capture_type, selected_text, title, tags)
         VALUES ($1, 'text', 'A representative saved passage.', 'Database transactions', ARRAY['postgres', 'data'])
         RETURNING id`,
        [userId],
      );
      await client.query(
        `INSERT INTO memories (user_id, capture_type, source_url, title)
         VALUES ($1, 'url', 'https://example.test/path', 'Example page')`,
        [userId],
      );

      await client.query(
        `INSERT INTO oauth_accounts (user_id, provider, provider_account_id)
         VALUES ($1, 'example', 'provider-subject-1')`,
        [userId],
      );
      await client.query(
        `INSERT INTO refresh_sessions (user_id, token_hash, expires_at)
         VALUES ($1, $2, now() + interval '1 day')`,
        [userId, Buffer.alloc(32, 1)],
      );
      const change = await client.query<{ sequence_id: string }>(
        `INSERT INTO memory_changes (user_id, memory_id, operation, version)
         VALUES ($1, $2, 'create', 1) RETURNING sequence_id`,
        [userId, firstRow(memory.rows).id],
      );

      assert.ok(BigInt(firstRow(change.rows).sequence_id) > 0n);
      const searchable = await client.query<{ matches_title_weight: boolean }>(
        `SELECT search_vector @@ to_tsquery('simple', 'transactions:A') AS matches_title_weight
         FROM memories WHERE id = $1`,
        [firstRow(memory.rows).id],
      );
      assert.equal(firstRow(searchable.rows).matches_title_weight, true);
    });
  });

  it('rejects invalid captures and change events attributed to another user', async () => {
    await withRollback(async (client) => {
      const user = await client.query<{ id: string }>(`INSERT INTO users DEFAULT VALUES RETURNING id`);
      const ownerId = firstRow(user.rows).id;
      await assert.rejects(
        client.query(`INSERT INTO memories (user_id, capture_type, selected_text)
                      VALUES ($1, 'video', 'unsupported')`, [ownerId]),
        { code: '23514' },
      );
    });

    await withRollback(async (client) => {
      const user = await client.query<{ id: string }>(`INSERT INTO users DEFAULT VALUES RETURNING id`);
      await assert.rejects(
        client.query(`INSERT INTO memories (user_id, capture_type, selected_text, revisit_count)
                      VALUES ($1, 'text', 'valid content', -1)`, [firstRow(user.rows).id]),
        { code: '23514' },
      );
    });

    await withRollback(async (client) => {
      const user = await client.query<{ id: string }>(`INSERT INTO users DEFAULT VALUES RETURNING id`);
      await assert.rejects(
        client.query(`INSERT INTO memories (user_id, capture_type, selected_text, version)
                      VALUES ($1, 'text', 'valid content', 0)`, [firstRow(user.rows).id]),
        { code: '23514' },
      );
    });

    await withRollback(async (client) => {
      const user = await client.query<{ id: string }>(`INSERT INTO users DEFAULT VALUES RETURNING id`);
      const ownerId = firstRow(user.rows).id;
      await assert.rejects(
        client.query(`INSERT INTO memories (user_id, capture_type, selected_text)
                      VALUES ($1, 'text', '   ')`, [ownerId]),
        { code: '23514' },
      );
    });

    await withRollback(async (client) => {
      const user = await client.query<{ id: string }>(`INSERT INTO users DEFAULT VALUES RETURNING id`);
      const ownerId = firstRow(user.rows).id;
      await assert.rejects(
        client.query(`INSERT INTO memories (user_id, capture_type, source_url)
                      VALUES ($1, 'url', 'javascript:alert(1)')`, [ownerId]),
        { code: '23514' },
      );
    });

    await withRollback(async (client) => {
      const owners = await client.query<{ id: string }>(
        `INSERT INTO users DEFAULT VALUES RETURNING id`,
      );
      const foreignUser = await client.query<{ id: string }>(`INSERT INTO users DEFAULT VALUES RETURNING id`);
      const memory = await client.query<{ id: string }>(
        `INSERT INTO memories (user_id, capture_type, selected_text)
         VALUES ($1, 'text', 'belongs to first user') RETURNING id`,
        [firstRow(owners.rows).id],
      );
      await assert.rejects(
        client.query(`INSERT INTO memory_changes (user_id, memory_id, operation, version)
                      VALUES ($1, $2, 'create', 1)`, [firstRow(foreignUser.rows).id, firstRow(memory.rows).id]),
        { code: '23503' },
      );
    });
  });

  it('rolls back a memory write if its change event cannot be recorded', async () => {
    const user = await testPool.query<{ id: string }>(`INSERT INTO users DEFAULT VALUES RETURNING id`);
    const userId = firstRow(user.rows).id;
    let transactionError: unknown;
    try {
      await withTransaction(testPool, async (client) => {
        const memory = await client.query<{ id: string }>(
          `INSERT INTO memories (user_id, capture_type, selected_text)
           VALUES ($1, 'text', 'must roll back') RETURNING id`,
          [userId],
        );
        await client.query(`INSERT INTO memory_changes (user_id, memory_id, operation, version)
                            VALUES ($1, $2, 'invalid', 1)`, [userId, firstRow(memory.rows).id]);
      });
    } catch (error) {
      transactionError = error;
    }

    assert.equal(postgresErrorCode(transactionError), '23514');
    const count = await testPool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM memories WHERE user_id = $1`, [userId],
    );
    assert.equal(count.rows[0]?.count, '0');
    await testPool.query(`DELETE FROM users WHERE id = $1`, [userId]);
  });
});
