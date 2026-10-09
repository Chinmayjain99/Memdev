import { z } from 'zod';

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  DB_HOST: z.string().trim().min(1).default('localhost'),
  DB_PORT: z.coerce.number().int().min(1).max(65_535).default(5432),
  DB_NAME: z.string().trim().min(1).default('memdev'),
  DB_TEST_NAME: z.string().trim().min(1).default('memdev_test'),
  DB_USER: z.string().trim().min(1).default('postgres'),
  DB_PASSWORD: z.string().default(''),
  DB_CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(100).max(30_000).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  AUTH_JWT_SECRET: z.string().min(32, 'AUTH_JWT_SECRET must be at least 32 characters'),
  AUTH_JWT_ISSUER: z.string().trim().min(1).default('memdev-api'),
  AUTH_JWT_AUDIENCE: z.string().trim().min(1).default('memdev-client'),
  AUTH_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(600),
  AUTH_REFRESH_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  AUTH_BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(14).default(12),
  AUTH_WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
});

export type AppConfig = z.infer<typeof environmentSchema>;

export function parseConfig(environment: NodeJS.ProcessEnv): AppConfig {
  const config = environmentSchema.parse(environment);
  if (config.NODE_ENV === 'production' && config.DB_PASSWORD.length === 0) {
    throw new Error('DB_PASSWORD must be set in production');
  }
  if (new URL(config.AUTH_WEB_ORIGIN).origin !== config.AUTH_WEB_ORIGIN) {
    throw new Error('AUTH_WEB_ORIGIN must not contain a path');
  }
  if (config.NODE_ENV === 'production' && new URL(config.AUTH_WEB_ORIGIN).protocol !== 'https:') {
    throw new Error('AUTH_WEB_ORIGIN must use HTTPS in production');
  }
  return config;
}
