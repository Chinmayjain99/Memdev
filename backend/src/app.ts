import express from 'express';
import helmet from 'helmet';
import type { Pool } from 'pg';
import { errorHandler, notFound } from './middleware/error-handler.js';
import { createHealthRouter } from './modules/health/health.routes.js';

export function createApp(pool: Pool) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: '100kb' }));
  app.use('/health', createHealthRouter(pool));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
