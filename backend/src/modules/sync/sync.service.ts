import { createHash, timingSafeEqual } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { withTransaction } from '../../database/transaction.js';
import * as memoryRepository from '../memories/memory.repository.js';
import { MemoryApiError, normalizeMemoryUpdate } from '../memories/memory.service.js';
import type { Memory } from '../memories/memory.types.js';
import type { SyncMutation } from './sync.validators.js';
import * as repository from './sync.repository.js';
import { z } from 'zod';

const bootstrapTokenSchema = z.strictObject({
  cursor: z.string().regex(/^(0|[1-9]\d{0,18})$/).refine((value) => BigInt(value) <= 9_223_372_036_854_775_807n),
  limit: z.number().int().min(1).max(500),
  after: z.strictObject({ createdAt: z.iso.datetime({ precision: 6 }), id: z.string().uuid() }),
});

export class SyncApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

function canonical(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function digest(mutation: SyncMutation): Buffer {
  return createHash('sha256').update(canonical(mutation)).digest();
}

function isSameHash(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createSyncService(pool: Pool) {
  return {
    async bootstrap(userId: string, limit: number, pageToken?: string) {
      let cursor: string;
      let after: { createdAt: string; id: string } | undefined;
      let rows: repository.SnapshotRow[];
      if (pageToken) {
        const decoded = decodeBootstrapToken(pageToken);
        if (!decoded || decoded.limit !== limit) throw new SyncApiError(400, 'INVALID_BOOTSTRAP_TOKEN', 'Invalid bootstrap page token');
        cursor = decoded.cursor;
        after = decoded.after;
        rows = await repository.listSnapshotPage(pool, userId, limit, after);
      } else {
        const page = await withTransaction(pool, async (client) => {
          await lockUser(client, userId);
          const snapshotRows = await repository.listSnapshotPage(client, userId, limit);
          const boundary = await repository.latestCursor(client, userId);
          return { rows: snapshotRows, cursor: boundary };
        });
        rows = page.rows;
        cursor = page.cursor;
      }
      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const last = page.at(-1);
      const nextPageToken = hasMore && last
        ? encodeBootstrapToken({ cursor, limit, after: { createdAt: last.cursorCreatedAt, id: last.id } })
        : null;
      return {
        memories: page.filter((row) => !row.isDeleted).map(repository.toSyncMemory),
        tombstones: page.filter((row) => row.isDeleted).map(repository.toSyncMemory),
        cursor,
        nextPageToken,
        hasMore,
      };
    },
    async changes(userId: string, cursor: string, limit: number) {
      const rows = await repository.readChanges(pool, userId, cursor, limit);
      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const last = page.at(-1);
      return {
        changes: page.map((row) => ({ cursor: row.cursor, memoryId: row.memoryId, operation: row.operation,
          version: row.version, serverCreatedAt: row.serverCreatedAt,
          memory: row.memory ? repository.toSyncMemory(row.memory) : { id: row.memoryId, version: row.version, deletedAt: null } })),
        nextCursor: last?.cursor ?? cursor,
        hasMore,
      };
    },
    async mutations(userId: string, mutations: SyncMutation[]) {
      const results = [];
      for (const mutation of mutations) {
        try {
          results.push(await applyOne(pool, userId, mutation));
        } catch (error) {
          if (!(error instanceof MemoryApiError) || error.status !== 400) throw error;
          results.push({ mutationId: mutation.mutationId, status: 'invalid' as const, code: error.code });
        }
      }
      return { results };
    },
  };
}

function decodeBootstrapToken(value: string): z.infer<typeof bootstrapTokenSchema> | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    return bootstrapTokenSchema.parse(parsed);
  } catch {
    return null;
  }
}

function encodeBootstrapToken(value: z.infer<typeof bootstrapTokenSchema>): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

async function applyOne(pool: Pool, userId: string, mutation: SyncMutation) {
  return withTransaction(pool, async (client) => {
    await lockUser(client, userId);
    const requestHash = digest(mutation);
    const prior = await repository.findMutation(client, userId, mutation.mutationId);
    if (prior) {
      if (!isSameHash(prior.requestHash, requestHash)) {
        return { mutationId: mutation.mutationId, status: 'conflict' as const, code: 'IDEMPOTENCY_KEY_REUSED' };
      }
      const current = prior.memoryId ? await repository.currentMemory(client, userId, prior.memoryId) : null;
      return resultFromRecord(mutation.mutationId, prior, current, true);
    }

    if (mutation.operation === 'create') {
      const memory = await memoryRepository.createMemory(client, userId, mutation.memory, mutation.memoryId);
      if (!memory) {
        const current = await repository.currentMemory(client, userId, mutation.memoryId);
        const sameOwner = current !== null;
        await repository.recordMutation(client, { userId, mutationId: mutation.mutationId, requestHash,
          operation: mutation.operation, memoryId: sameOwner ? mutation.memoryId : null, status: 'conflict',
          conflictCode: 'MEMORY_ALREADY_EXISTS' });
        return { mutationId: mutation.mutationId, status: 'conflict' as const, code: 'MEMORY_ALREADY_EXISTS',
          ...(current ? { memory: repository.toSyncMemory(current), version: current.version } : {}) };
      }
      const cursor = await memoryRepository.addMemoryChange(client, { userId, memoryId: memory.id, operation: 'create', version: memory.version });
      await repository.recordMutation(client, { userId, mutationId: mutation.mutationId, requestHash,
        operation: mutation.operation, memoryId: memory.id, status: 'applied', resultVersion: memory.version, cursor });
      return { mutationId: mutation.mutationId, status: 'applied' as const, memory, version: memory.version, cursor };
    }

    const current = await memoryRepository.findMemoryForUpdate(client, userId, mutation.memoryId, true);
    if (!current) {
      await repository.recordMutation(client, { userId, mutationId: mutation.mutationId, requestHash,
        operation: mutation.operation, memoryId: null, status: 'not_found', conflictCode: 'MEMORY_NOT_FOUND',
        baseVersion: mutation.baseVersion });
      return { mutationId: mutation.mutationId, status: 'not_found' as const, code: 'MEMORY_NOT_FOUND' };
    }
    if (current.isDeleted || current.version !== mutation.baseVersion) {
      const currentRepresentation = await repository.currentMemory(client, userId, mutation.memoryId);
      await repository.recordMutation(client, { userId, mutationId: mutation.mutationId, requestHash,
        operation: mutation.operation, memoryId: mutation.memoryId, status: 'conflict', conflictCode: 'VERSION_CONFLICT',
        baseVersion: mutation.baseVersion, resultVersion: current.version });
      return { mutationId: mutation.mutationId, status: 'conflict' as const, code: 'VERSION_CONFLICT',
        ...(currentRepresentation ? { memory: repository.toSyncMemory(currentRepresentation) } : {}),
        baseVersion: mutation.baseVersion, version: current.version };
    }

    let memory: Memory;
    if (mutation.operation === 'update') {
      const patch = normalizeMemoryUpdate(current, mutation.patch);
      memory = await memoryRepository.updateMemory(client, userId, mutation.memoryId, patch);
    } else {
      memory = await memoryRepository.softDeleteMemory(client, userId, mutation.memoryId);
    }
    const cursor = await memoryRepository.addMemoryChange(client, {
      userId, memoryId: mutation.memoryId, operation: mutation.operation, version: memory.version,
    });
    await repository.recordMutation(client, { userId, mutationId: mutation.mutationId, requestHash,
      operation: mutation.operation, memoryId: mutation.memoryId, status: 'applied',
      baseVersion: mutation.baseVersion, resultVersion: memory.version, cursor });
    const deleted = mutation.operation === 'delete' ? await repository.currentMemory(client, userId, mutation.memoryId) : null;
    return { mutationId: mutation.mutationId, status: 'applied' as const,
      memory: deleted ? repository.toSyncMemory(deleted) : memory,
      version: memory.version, cursor };
  });
}

async function lockUser(client: PoolClient, userId: string): Promise<void> {
  if (!await memoryRepository.lockUser(client, userId)) throw new SyncApiError(404, 'SYNC_NOT_FOUND', 'Sync state not found');
}

function resultFromRecord(mutationId: string, record: {
  status: string; conflictCode: string | null; memoryId: string | null; baseVersion: number | null;
  resultVersion: number | null; cursor: string | null;
}, current: repository.SyncMemoryRow | null, replayed: boolean) {
  if (record.status === 'applied') {
    return { mutationId, status: 'applied' as const, ...(current ? { memory: repository.toSyncMemory(current) } : {}),
      version: record.resultVersion, cursor: record.cursor, replayed };
  }
  return { mutationId, status: record.status as 'conflict' | 'not_found', code: record.conflictCode,
    ...(record.status === 'conflict' ? { ...(current ? { memory: repository.toSyncMemory(current), version: current.version } : {}),
      ...(record.baseVersion !== null ? { baseVersion: record.baseVersion } : {}) } : {}), replayed };
}
