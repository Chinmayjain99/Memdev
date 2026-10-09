import type { Pool, PoolClient } from 'pg';
import { withTransaction } from '../../database/transaction.js';
import * as repository from './memory.repository.js';
import { encodePageCursor } from './memory.validators.js';
import type { CreateMemoryInput, UpdateMemoryInput } from './memory.validators.js';
import type { Memory, MemoryPage, PageCursor } from './memory.types.js';

export class MemoryApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

export function normalizeMemoryUpdate(current: Pick<Memory, 'isCode' | 'codeLanguage'>, patch: UpdateMemoryInput): UpdateMemoryInput {
  const safePatch: UpdateMemoryInput = patch.isCode === false && patch.codeLanguage === undefined
    ? { ...patch, codeLanguage: null }
    : patch;
  const nextIsCode = safePatch.isCode ?? current.isCode;
  const nextCodeLanguage = safePatch.codeLanguage === undefined ? current.codeLanguage : safePatch.codeLanguage;
  if (!nextIsCode && nextCodeLanguage !== null) {
    throw new MemoryApiError(400, 'INVALID_CODE_METADATA', 'Clear codeLanguage when isCode is false');
  }
  return safePatch;
}

export function createMemoryService(pool: Pool) {
  async function lockUser(client: PoolClient, userId: string): Promise<void> {
    if (!await repository.lockUser(client, userId)) throw new MemoryApiError(404, 'MEMORY_NOT_FOUND', 'Memory not found');
  }

  return {
    create(userId: string, input: CreateMemoryInput): Promise<Memory> {
      return withTransaction(pool, async (client) => {
        await lockUser(client, userId);
        const memory = await repository.createMemory(client, userId, input);
        if (!memory) throw new Error('Memory insert returned no row');
        await repository.addMemoryChange(client, { userId, memoryId: memory.id, operation: 'create', version: memory.version });
        return memory;
      });
    },
    async list(userId: string, limit: number, cursor?: PageCursor): Promise<MemoryPage> {
      const rows = await repository.listMemories(pool, userId, limit + 1, cursor);
      const hasMore = rows.length > limit;
      const pageRows = hasMore ? rows.slice(0, limit) : rows;
      const last = pageRows.at(-1);
      const memories = pageRows.map(({ cursorCreatedAt, ...memory }) => {
        void cursorCreatedAt;
        return memory;
      });
      return { memories, hasMore, nextCursor: hasMore && last ? encodePageCursor({ createdAt: last.cursorCreatedAt, id: last.id }) : null };
    },
    async get(userId: string, memoryId: string): Promise<Memory> {
      const memory = await repository.findMemory(pool, userId, memoryId);
      if (!memory) throw notFound();
      return memory;
    },
    update(userId: string, memoryId: string, expectedVersion: number, patch: UpdateMemoryInput): Promise<Memory> {
      return withTransaction(pool, async (client) => {
        await lockUser(client, userId);
        const current = await repository.findMemoryForUpdate(client, userId, memoryId);
        if (!current) throw notFound();
        if (current.version !== expectedVersion) {
          throw new MemoryApiError(409, 'VERSION_CONFLICT', 'Memory has changed; fetch the latest version and retry');
        }
        const safePatch = normalizeMemoryUpdate(current, patch);
        const memory = await repository.updateMemory(client, userId, memoryId, safePatch);
        await repository.addMemoryChange(client, { userId, memoryId, operation: 'update', version: memory.version });
        return memory;
      });
    },
    async remove(userId: string, memoryId: string): Promise<void> {
      await withTransaction(pool, async (client) => {
        await lockUser(client, userId);
        const current = await repository.findMemoryForUpdate(client, userId, memoryId, true);
        if (!current) throw notFound();
        if (current.isDeleted) return;
        const memory = await repository.softDeleteMemory(client, userId, memoryId);
        await repository.addMemoryChange(client, { userId, memoryId, operation: 'delete', version: memory.version });
      });
    },
    revisit(userId: string, memoryId: string): Promise<Memory> {
      return withTransaction(pool, async (client) => {
        await lockUser(client, userId);
        const memory = await repository.revisitMemory(client, userId, memoryId);
        if (!memory) throw notFound();
        await repository.addMemoryChange(client, { userId, memoryId, operation: 'update', version: memory.version });
        return memory;
      });
    },
  };
}

function notFound(): MemoryApiError {
  return new MemoryApiError(404, 'MEMORY_NOT_FOUND', 'Memory not found');
}
