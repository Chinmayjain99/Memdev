import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import type { Pool } from 'pg';
import type { AppConfig } from '../../config/env.js';
import { createAuthService } from './auth.service.js';
import { requireAuth, requireSameOrigin } from './auth.middleware.js';
import { loginSchema, registerSchema } from './auth.validators.js';

const cookieName = 'memdev_refresh';

export function createAuthRouter(pool: Pool, config: AppConfig): Router {
  const router = Router();
  const auth = createAuthService(pool, config);
  const limit = rateLimit({ windowMs: 15 * 60_000, limit: config.NODE_ENV === 'test' ? 1000 : 10,
    standardHeaders: 'draft-8', legacyHeaders: false,
    handler: (_request, response) => response.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many authentication requests' } }),
  });
  const csrf = requireSameOrigin;
  router.post('/register', csrf, limit, async (request, response, next) => {
    const input = registerSchema.safeParse(request.body);
    if (!input.success) { response.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid registration details' } }); return; }
    try { sendAuth(response, await auth.register(input.data), config, 201); } catch (error) { next(error); }
  });
  router.post('/login', csrf, limit, async (request, response, next) => {
    const input = loginSchema.safeParse(request.body);
    if (!input.success) { response.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid login details' } }); return; }
    try { sendAuth(response, await auth.login(input.data), config); } catch (error) { next(error); }
  });
  router.post('/refresh', csrf, limit, async (request, response, next) => {
    try {
      sendAuth(response, await auth.refresh(request.cookies?.[cookieName] ?? ''), config);
    } catch (error) { response.clearCookie(cookieName, cookieOptions(config)); next(error); }
  });
  router.post('/logout', csrf, async (request, response, next) => {
    try { await auth.logout(request.cookies?.[cookieName]); response.clearCookie(cookieName, cookieOptions(config)); response.status(204).end(); }
    catch (error) { next(error); }
  });
  router.post('/logout-all', csrf, requireAuth(config), async (request, response, next) => {
    const userId = request.auth?.id;
    if (!userId) { response.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }); return; }
    try { await auth.logoutAll(userId); response.clearCookie(cookieName, cookieOptions(config)); response.status(204).end(); }
    catch (error) { next(error); }
  });
  router.get('/me', requireAuth(config), async (request, response, next) => {
    try {
      const userId = request.auth?.id;
      if (!userId) { response.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }); return; }
      const user = await auth.me(userId);
      if (!user) { response.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }); return; }
      response.json({ user });
    } catch (error) { next(error); }
  });
  return router;
}

function cookieOptions(config: AppConfig) {
  return { httpOnly: true, secure: config.NODE_ENV === 'production', sameSite: 'lax' as const,
    path: '/auth', maxAge: config.AUTH_REFRESH_TTL_DAYS * 86_400_000 };
}
function sendAuth(response: import('express').Response, result: Awaited<ReturnType<ReturnType<typeof createAuthService>['register']>>, config: AppConfig, status = 200): void {
  const body = { user: result.user, accessToken: result.accessToken, expiresIn: result.expiresIn };
  response.cookie(cookieName, result.refreshToken, cookieOptions(config));
  response.status(status).json(body);
}
