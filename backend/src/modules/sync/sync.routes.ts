import { Router } from 'express';
import type { Pool } from 'pg';
import type { AppConfig } from '../../config/env.js';
import { requireAuth } from '../auth/auth.middleware.js';
import { createSyncController } from './sync.controller.js';

export function createSyncRouter(pool: Pool, config: AppConfig): Router {
  const router = Router();
  router.use(requireAuth(config));
  const controller = createSyncController(pool);
  router.get('/bootstrap', controller.bootstrap);
  router.get('/changes', controller.changes);
  router.post('/mutations', controller.mutations);
  return router;
}
