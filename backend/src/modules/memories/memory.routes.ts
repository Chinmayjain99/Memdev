import { Router } from 'express';
import type { Pool } from 'pg';
import type { AppConfig } from '../../config/env.js';
import { requireAuth } from '../auth/auth.middleware.js';
import { createMemoryController } from './memory.controller.js';

export function createMemoryRouter(pool: Pool, config: AppConfig): Router {
  const router = Router();
  const controller = createMemoryController(pool);
  router.use(requireAuth(config));
  router.post('/', controller.create);
  router.get('/', controller.list);
  router.get('/:id', controller.get);
  router.patch('/:id', controller.update);
  router.delete('/:id', controller.remove);
  router.post('/:id/revisit', controller.revisit);
  return router;
}
