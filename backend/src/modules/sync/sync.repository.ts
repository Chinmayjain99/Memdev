import type { Pool, PoolClient } from 'pg';
import { memoryColumns } from '../memories/memory.repository.js';

export type SyncMemoryRow = {
  id: string; isDeleted: boolean; deletedAt: Date | null; version: number;
  captureType: 'text' | 'url'; title: string | null; selectedText: string | null; manualNote: string | null;
  sourceUrl: string | null; pageTitle: string | null; domain: string | null; tags: string[]; topic: string | null;
  language: string | null; isCode: boolean; codeLanguage: string | null; clientCreatedAt: Date | null;
  createdAt: Date; updatedAt: Date; lastRevisitedAt: Date | null; revisitCount: number;
};

const syncMemoryColumns = `${memoryColumns},is_deleted AS "isDeleted",deleted_at AS "deletedAt"`;

export type SnapshotRow = SyncMemoryRow & { cursorCreatedAt: string };

export async function listSnapshotPage(db: Pool | PoolClient, userId: string, limit: number,
  after?: { createdAt: string; id: string }): Promise<SnapshotRow[]> {
  const result = await db.query<SnapshotRow>(
    `SELECT ${syncMemoryColumns},
            to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "cursorCreatedAt"
     FROM memories
     WHERE user_id=$1 AND ($2::timestamptz IS NULL OR created_at < $2::timestamptz
       OR (created_at=$2::timestamptz AND id > $3::uuid))
     ORDER BY created_at DESC,id ASC LIMIT $4`,
    [userId,after?.createdAt ?? null,after?.id ?? null,limit + 1]);
  return result.rows;
}

export async function currentMemory(client: PoolClient, userId: string, memoryId: string): Promise<SyncMemoryRow | null> {
  const result = await client.query<SyncMemoryRow>(
    `SELECT ${syncMemoryColumns} FROM memories WHERE user_id=$1 AND id=$2`, [userId, memoryId]);
  return result.rows[0] ?? null;
}

export async function readChanges(pool: Pool, userId: string, cursor: string, limit: number) {
  const result = await pool.query<{
    cursor: string; memoryId: string; operation: 'create' | 'update' | 'delete'; version: number;
    serverCreatedAt: Date; memory: SyncMemoryRow | null;
  }>(`SELECT c.sequence_id::text AS cursor,c.memory_id AS "memoryId",c.operation,c.version,
             c.server_created_at AS "serverCreatedAt",
             CASE WHEN m.id IS NULL THEN NULL ELSE row_to_json(m)::jsonb END AS memory
      FROM memory_changes c LEFT JOIN LATERAL (
        SELECT ${syncMemoryColumns} FROM memories WHERE user_id=c.user_id AND id=c.memory_id
      ) m ON true
      WHERE c.user_id=$1 AND c.sequence_id > $2::bigint
      ORDER BY c.sequence_id ASC LIMIT $3`, [userId, cursor, limit + 1]);
  return result.rows;
}

export async function latestCursor(client: PoolClient, userId: string): Promise<string> {
  const result = await client.query<{ cursor: string }>(
    'SELECT COALESCE(max(sequence_id),0)::text AS cursor FROM memory_changes WHERE user_id=$1', [userId]);
  const row = result.rows[0];
  if (!row) throw new Error('Cursor query returned no row');
  return row.cursor;
}

export async function findMutation(client: PoolClient, userId: string, mutationId: string) {
  const result = await client.query<{
    requestHash: Buffer; operation: string; memoryId: string | null; status: string;
    conflictCode: string | null; baseVersion: number | null; resultVersion: number | null; cursor: string | null;
  }>(`SELECT request_hash AS "requestHash",operation,memory_id AS "memoryId",status,
             conflict_code AS "conflictCode",base_version AS "baseVersion",result_version AS "resultVersion",
             change_sequence_id::text AS cursor
      FROM sync_mutations WHERE user_id=$1 AND mutation_id=$2`, [userId, mutationId]);
  return result.rows[0] ?? null;
}

export async function recordMutation(client: PoolClient, input: {
  userId: string; mutationId: string; requestHash: Buffer; operation: string; memoryId: string | null;
  status: 'applied' | 'conflict' | 'not_found'; conflictCode?: string; baseVersion?: number;
  resultVersion?: number; cursor?: string;
}): Promise<void> {
  await client.query(`INSERT INTO sync_mutations
    (user_id,mutation_id,request_hash,operation,memory_id,status,conflict_code,base_version,result_version,change_sequence_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [input.userId,input.mutationId,input.requestHash,input.operation,input.memoryId,input.status,
      input.conflictCode ?? null,input.baseVersion ?? null,input.resultVersion ?? null,input.cursor ?? null]);
}

export function toSyncMemory(row: SyncMemoryRow) {
  if (row.isDeleted) return { id: row.id, version: row.version, deletedAt: row.deletedAt };
  const { isDeleted, deletedAt, ...memory } = row;
  void isDeleted;
  void deletedAt;
  return memory;
}
