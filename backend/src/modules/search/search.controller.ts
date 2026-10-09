import type { RequestHandler } from 'express';
import type { Pool } from 'pg';
import { searchQuerySchema } from './search.validators.js';
import { createSearchService } from './search.service.js';

export function createSearchController(pool: Pool): { search: RequestHandler } {
  const service = createSearchService(pool);
  return {
    search: async (request, response, next): Promise<void> => {
      const userId = request.auth?.id;
      if (!userId) {
        response.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
        return;
      }
      const parsed = searchQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid search request' } });
        return;
      }
      try {
        response.json(await service.search(userId, parsed.data));
      } catch (error) {
        next(error);
      }
    },
  };
}
