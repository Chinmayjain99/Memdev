import type { Pool, PoolClient } from 'pg';
import type { CreateMemoryInput, UpdateMemoryInput } from './memory.validators.js';
import type { Memory, PageCursor } from './memory.types.js';

export const memoryColumns = `
  id, capture_type AS "captureType", title, selected_text AS "selectedText",
  manual_note AS "manualNote", source_url AS "sourceUrl", page_title AS "pageTitle",
  domain, tags, topic, language, is_code AS "isCode", code_language AS "codeLanguage",
  client_created_at AS "clientCreatedAt", created_at AS "createdAt", updated_at AS "updatedAt",
  last_revisited_at AS "lastRevisitedAt", revisit_count AS "revisitCount", version`;

export async function lockUser(client: PoolClient, userId: string): Promise<boolean> {
  const result = await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId]);
  return result.rowCount === 1;
}

export async function createMemory(client: PoolClient, userId: string, input: CreateMemoryInput, id?: string): Promise<Memory | null> {
  const result = await client.query<Memory>(
    `INSERT INTO memories (
       ${id ? 'id,' : ''}user_id,capture_type,title,selected_text,manual_note,source_url,page_title,domain,tags,topic,language,
       is_code,code_language,client_created_at
     ) VALUES (${id ? '$1,' : ''}${Array.from({ length: 14 }, (_, i) => `$${i + (id ? 2 : 1)}`).join(',')})
     ${id ? 'ON CONFLICT (id) DO NOTHING' : ''}
     RETURNING ${memoryColumns}`,
    [...(id ? [id] : []),userId,input.captureType,input.title ?? null,input.selectedText ?? null,input.manualNote ?? null,
      input.sourceUrl ?? null,input.pageTitle ?? null,input.domain ?? null,input.tags ?? [],input.topic ?? null,
      input.language ?? null,input.isCode ?? false,input.codeLanguage ?? null,input.clientCreatedAt ?? null],
  );
  const memory = result.rows[0];
  return memory ?? null;
}

export async function addMemoryChange(
  client: PoolClient,
  change: { userId: string; memoryId: string; operation: 'create' | 'update' | 'delete'; version: number },
): Promise<string> {
  const result = await client.query<{ sequenceId: string }>(
    'INSERT INTO memory_changes (user_id,memory_id,operation,version) VALUES ($1,$2,$3,$4) RETURNING sequence_id AS "sequenceId"',
    [change.userId,change.memoryId,change.operation,change.version],
  );
  const inserted = result.rows[0];
  if (!inserted) throw new Error('Memory change insert returned no cursor');
  return inserted.sequenceId;
}

export async function listMemories(pool: Pool, userId: string, limit: number, cursor: PageCursor | undefined): Promise<(Memory & { cursorCreatedAt: string })[]> {
  const result = await pool.query<Memory & { cursorCreatedAt: string }>(
    `SELECT ${memoryColumns},to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "cursorCreatedAt"
     FROM memories
     WHERE user_id=$1 AND is_deleted=false
       AND ($2::timestamptz IS NULL OR created_at < $2 OR (created_at=$2 AND id > $3::uuid))
     ORDER BY created_at DESC,id ASC LIMIT $4`,
    [userId,cursor?.createdAt ?? null,cursor?.id ?? null,limit],
  );
  return result.rows;
}

export async function findMemory(pool: Pool, userId: string, memoryId: string): Promise<Memory | null> {
  const result = await pool.query<Memory>(
    `SELECT ${memoryColumns} FROM memories WHERE id=$1 AND user_id=$2 AND is_deleted=false`, [memoryId,userId]);
  return result.rows[0] ?? null;
}

export async function findMemoryForUpdate(client: PoolClient, userId: string, memoryId: string, includeDeleted = false): Promise<(Memory & { isDeleted: boolean }) | null> {
  const deletedFilter = includeDeleted ? '' : 'AND is_deleted=false';
  const result = await client.query<Memory & { isDeleted: boolean }>(
    `SELECT ${memoryColumns},is_deleted AS "isDeleted" FROM memories WHERE id=$1 AND user_id=$2 ${deletedFilter} FOR UPDATE`, [memoryId,userId]);
  return result.rows[0] ?? null;
}

const editableColumns: Record<keyof UpdateMemoryInput, string> = {
  title: 'title', manualNote: 'manual_note', tags: 'tags', topic: 'topic', language: 'language',
  pageTitle: 'page_title', domain: 'domain', isCode: 'is_code', codeLanguage: 'code_language',
};

export async function updateMemory(client: PoolClient, userId: string, memoryId: string, patch: UpdateMemoryInput): Promise<Memory> {
  const values: unknown[] = [memoryId,userId];
  const assignments: string[] = [];
  for (const key of Object.keys(editableColumns) as (keyof UpdateMemoryInput)[]) {
    const value = patch[key];
    if (value !== undefined) {
      values.push(value);
      assignments.push(`${editableColumns[key]}=$${values.length}`);
    }
  }
  if (assignments.length === 0) throw new Error('Validated memory update had no editable fields');
  const result = await client.query<Memory>(
    `UPDATE memories SET ${assignments.join(', ')}, version=version+1
     WHERE id=$1 AND user_id=$2 AND is_deleted=false RETURNING ${memoryColumns}`,
    values,
  );
  const memory = result.rows[0];
  if (!memory) throw new Error('Locked memory disappeared during update');
  return memory;
}

export async function softDeleteMemory(client: PoolClient, userId: string, memoryId: string): Promise<Memory> {
  const result = await client.query<Memory>(
    `UPDATE memories SET is_deleted=true,deleted_at=now(),version=version+1
     WHERE id=$1 AND user_id=$2 AND is_deleted=false RETURNING ${memoryColumns}`,
    [memoryId,userId],
  );
  const memory = result.rows[0];
  if (!memory) throw new Error('Locked memory disappeared during deletion');
  return memory;
}

export async function revisitMemory(client: PoolClient, userId: string, memoryId: string): Promise<Memory | null> {
  const result = await client.query<Memory>(
    `UPDATE memories SET revisit_count=revisit_count+1,last_revisited_at=now(),version=version+1
     WHERE id=$1 AND user_id=$2 AND is_deleted=false RETURNING ${memoryColumns}`,
    [memoryId,userId],
  );
  return result.rows[0] ?? null;
}
