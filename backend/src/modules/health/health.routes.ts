import { Router } from 'express';
import type { Pool } from 'pg';
import { checkDatabase } from './health.service.js';

export function createHealthRouter(pool: Pool): Router {
  const router = Router();

  router.get('/', (_request, response) => {
    response.status(200).json({ status: 'ok' });
  });

  router.get('/database', async (_request, response) => {
    const available = await checkDatabase(pool);
    response.status(available ? 200 : 503).json({ database: available ? 'ok' : 'unavailable' });
  });

  return router;
}
