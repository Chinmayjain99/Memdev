import type { ErrorRequestHandler, Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.js';
import { AuthError } from '../modules/auth/auth.service.js';
import { MemoryApiError } from '../modules/memories/memory.service.js';

export function notFound(_request: Request, response: Response, next: NextFunction): void {
  void next;
  response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
}

export const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, next) => {
  void next;
  if (error instanceof AuthError) {
    response.status(error.status).json({ error: { code: error.code, message: error.message } });
    return;
  }
  if (error instanceof MemoryApiError) {
    response.status(error.status).json({ error: { code: error.code, message: error.message } });
    return;
  }
  logger.error({ name: error instanceof Error ? error.name : 'UnknownError' }, 'Unhandled request error');
  response.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error' } });
};
