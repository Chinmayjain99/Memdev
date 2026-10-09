import { Router } from 'express';
import type { Pool } from 'pg';
import type { AppConfig } from '../../config/env.js';
import { requireAuth } from '../auth/auth.middleware.js';
import { createSearchController } from './search.controller.js';

export function createSearchRouter(pool: Pool, config: AppConfig): Router {
  const router = Router();
  router.use(requireAuth(config));
  router.get('/', createSearchController(pool).search);
  return router;
}
