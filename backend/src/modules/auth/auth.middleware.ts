import type { RequestHandler } from 'express';
import type { AppConfig } from '../../config/env.js';
import { verifyAccessToken } from './auth.tokens.js';

export function requireAuth(config: AppConfig): RequestHandler {
  return (request, response, next) => {
    const value = request.get('authorization');
    const match = value?.match(/^Bearer ([^\s]+)$/i);
    const token = match?.[1];
    if (!token) {
      response.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }
    void verifyAccessToken(token, config).then((id) => {
      request.auth = { id };
      next();
    }).catch(() => response.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }));
  };
}

export const requireSameOrigin: RequestHandler = (request, response, next) => {
  const allowed = request.app.get('authWebOrigin') as string | undefined;
  if (request.get('origin') !== allowed || request.get('x-memdev-request') !== '1') {
    response.status(403).json({ error: { code: 'CSRF_REJECTED', message: 'Request origin could not be verified' } });
    return;
  }
  next();
};
