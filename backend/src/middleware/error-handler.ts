import type { ErrorRequestHandler, Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.js';

export function notFound(_request: Request, response: Response, next: NextFunction): void {
  void next;
  response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
}

export const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, next) => {
  void next;
  logger.error({ err: error }, 'Unhandled request error');
  response.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error' } });
};
