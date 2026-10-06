import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import type { AppConfig } from './config/env.js';
import type { Pool } from 'pg';
import { errorHandler, notFound } from './middleware/error-handler.js';
import { createHealthRouter } from './modules/health/health.routes.js';
import { createAuthRouter } from './modules/auth/auth.routes.js';
import { createMemoryRouter } from './modules/memories/memory.routes.js';
import { createSearchRouter } from './modules/search/search.routes.js';
import { createSyncRouter } from './modules/sync/sync.routes.js';
import { config as defaultConfig } from './config/index.js';

export function createApp(pool: Pool, config: AppConfig = defaultConfig) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: config.AUTH_WEB_ORIGIN, credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'If-Match', 'X-Memdev-Request'],
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'] }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.set('authWebOrigin', config.AUTH_WEB_ORIGIN);
  app.use('/health', createHealthRouter(pool));
  app.use('/auth', createAuthRouter(pool, config));
  app.use('/memories/search', createSearchRouter(pool, config));
  app.use('/memories', createMemoryRouter(pool, config));
  app.use('/sync', createSyncRouter(pool, config));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
