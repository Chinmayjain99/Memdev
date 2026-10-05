import { SignJWT, jwtVerify } from 'jose';
import { z } from 'zod';
import type { AppConfig } from '../../config/env.js';

const uuid = z.string().uuid();
const key = (config: AppConfig): Uint8Array => new TextEncoder().encode(config.AUTH_JWT_SECRET);

export async function signAccessToken(userId: string, config: AppConfig): Promise<string> {
  return new SignJWT({ token_use: 'access' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(userId).setIssuer(config.AUTH_JWT_ISSUER).setAudience(config.AUTH_JWT_AUDIENCE)
    .setIssuedAt().setExpirationTime(`${config.AUTH_ACCESS_TTL_SECONDS}s`).sign(key(config));
}

export async function verifyAccessToken(token: string, config: AppConfig): Promise<string> {
  const { payload, protectedHeader } = await jwtVerify(token, key(config), {
    algorithms: ['HS256'], issuer: config.AUTH_JWT_ISSUER, audience: config.AUTH_JWT_AUDIENCE,
    requiredClaims: ['sub', 'iat', 'exp', 'iss', 'aud', 'token_use'],
  });
  const subject = payload.sub;
  if (protectedHeader.typ !== 'JWT' || payload.token_use !== 'access' || typeof subject !== 'string' || !uuid.safeParse(subject).success) {
    throw new Error('Invalid access token');
  }
  return subject;
}
