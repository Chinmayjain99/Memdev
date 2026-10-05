import type { Pool, PoolClient } from 'pg';

export async function withTransaction<Result>(
  pool: Pool,
  operation: (client: PoolClient) => Promise<Result>,
): Promise<Result> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve the original operation error.
    }
    throw error;
  } finally {
    client.release();
  }
}
