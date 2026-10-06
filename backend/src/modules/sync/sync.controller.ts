import type { Request, RequestHandler, Response } from 'express';
import type { Pool } from 'pg';
import { createSyncService } from './sync.service.js';
import { changesQuerySchema, mutationsBodySchema } from './sync.validators.js';

export function createSyncController(pool: Pool) {
  const service = createSyncService(pool);
  return {
    bootstrap: async (request: Request, response: Response, next: (error?: unknown) => void) => {
      const userId = authenticatedId(request, response);
      if (!userId) return;
      try { response.json(await service.bootstrap(userId)); }
      catch (error) { next(error); }
    },
    changes: async (request: Request, response: Response, next: (error?: unknown) => void) => {
      const userId = authenticatedId(request, response);
      if (!userId) return;
      const query = changesQuerySchema.safeParse(request.query);
      if (!query.success) { invalid(response); return; }
      try { response.json(await service.changes(userId, query.data.cursor, query.data.limit)); }
      catch (error) { next(error); }
    },
    mutations: async (request: Request, response: Response, next: (error?: unknown) => void) => {
      const userId = authenticatedId(request, response);
      if (!userId) return;
      const body = mutationsBodySchema.safeParse(request.body);
      if (!body.success) { invalid(response); return; }
      try {
        const result = await service.mutations(userId, body.data.mutations);
        const hasConflict = result.results.some((item) => item.status === 'conflict');
        response.status(hasConflict ? 409 : 200).json(result);
      }
      catch (error) { next(error); }
    },
  } satisfies Record<string, RequestHandler>;
}

function authenticatedId(request: Request, response: Response): string | null {
  const id = request.auth?.id;
  if (id) return id;
  response.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
  return null;
}

function invalid(response: Response): void {
  response.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid sync request' } });
}
