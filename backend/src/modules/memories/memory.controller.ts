import type { Request, RequestHandler, Response } from 'express';
import type { Pool } from 'pg';
import { createMemoryService } from './memory.service.js';
import { createMemorySchema, decodePageCursor, listMemoryQuerySchema, updateMemorySchema } from './memory.validators.js';
import type { PageCursor } from './memory.types.js';
import { z } from 'zod';

const idSchema = z.string().uuid();

export function createMemoryController(pool: Pool) {
  const service = createMemoryService(pool);

  return {
    create: async (request: Request, response: Response, next: (error?: unknown) => void): Promise<void> => {
      const userId = authenticatedId(request, response);
      if (!userId) return;
      const input = createMemorySchema.safeParse(request.body);
      if (!input.success) { invalid(response); return; }
      try {
        const memory = await service.create(userId, input.data);
        setEtag(response, memory.version);
        response.location(`/memories/${memory.id}`).status(201).json({ memory });
      } catch (error) { next(error); }
    },
    list: async (request: Request, response: Response, next: (error?: unknown) => void): Promise<void> => {
      const userId = authenticatedId(request, response);
      if (!userId) return;
      const query = listMemoryQuerySchema.safeParse(request.query);
      if (!query.success) { invalid(response); return; }
      let cursor: PageCursor | undefined;
      if (query.data.cursor) {
        const decoded = decodePageCursor(query.data.cursor);
        if (!decoded) { invalid(response); return; }
        cursor = decoded;
      }
      try { response.json(await service.list(userId, query.data.limit, cursor)); }
      catch (error) { next(error); }
    },
    get: async (request: Request, response: Response, next: (error?: unknown) => void): Promise<void> => {
      const userId = authenticatedId(request, response);
      if (!userId) return;
      const id = parseId(request.params.id);
      if (!id) { invalid(response); return; }
      try {
        const memory = await service.get(userId, id);
        setEtag(response, memory.version);
        response.json({ memory });
      } catch (error) { next(error); }
    },
    update: async (request: Request, response: Response, next: (error?: unknown) => void): Promise<void> => {
      const userId = authenticatedId(request, response);
      if (!userId) return;
      const id = parseId(request.params.id);
      const patch = updateMemorySchema.safeParse(request.body);
      const version = parseIfMatch(request.get('if-match'));
      if (!id || !patch.success) { invalid(response); return; }
      if (version.kind === 'missing') {
        response.status(428).json({ error: { code: 'PRECONDITION_REQUIRED', message: 'If-Match with the current memory version is required' } });
        return;
      }
      if (version.kind === 'invalid') { invalid(response); return; }
      try {
        const memory = await service.update(userId, id, version.value, patch.data);
        setEtag(response, memory.version);
        response.json({ memory });
      } catch (error) { next(error); }
    },
    remove: async (request: Request, response: Response, next: (error?: unknown) => void): Promise<void> => {
      const userId = authenticatedId(request, response);
      if (!userId) return;
      const id = parseId(request.params.id);
      if (!id) { invalid(response); return; }
      try { await service.remove(userId, id); response.status(204).end(); }
      catch (error) { next(error); }
    },
    revisit: async (request: Request, response: Response, next: (error?: unknown) => void): Promise<void> => {
      const userId = authenticatedId(request, response);
      if (!userId) return;
      const id = parseId(request.params.id);
      if (!id) { invalid(response); return; }
      try {
        const memory = await service.revisit(userId, id);
        setEtag(response, memory.version);
        response.json({ memory });
      } catch (error) { next(error); }
    },
  } satisfies Record<string, RequestHandler>;
}

function authenticatedId(request: Request, response: Response): string | null {
  const id = request.auth?.id;
  if (id) return id;
  response.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
  return null;
}

function parseId(value: string | string[] | undefined): string | null {
  const parsed = idSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function parseIfMatch(value: string | undefined): { kind: 'value'; value: number } | { kind: 'missing' } | { kind: 'invalid' } {
  if (value === undefined) return { kind: 'missing' };
  const match = /^"([1-9]\d*)"$/.exec(value);
  const version = match?.[1] ? Number(match[1]) : NaN;
  return Number.isSafeInteger(version) ? { kind: 'value', value: version } : { kind: 'invalid' };
}

function setEtag(response: Response, version: number): void { response.setHeader('ETag', `"${version}"`); }
function invalid(response: Response): void {
  response.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid memory request' } });
}
